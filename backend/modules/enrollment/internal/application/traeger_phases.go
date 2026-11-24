package application

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// TraegerPhaseReads read the Träger phases; the administration serves them
// unchanged.
type TraegerPhaseReads interface {
	ListTraegerPhases(ctx context.Context, organizationID int64) ([]enrollment.TraegerPhase, error)
	TraegerPhase(ctx context.Context, organizationID, id int64) (enrollment.TraegerPhase, error)
	// LockTraegerPhase reads the phase under its row lock.
	LockTraegerPhase(ctx context.Context, organizationID, id int64) (enrollment.TraegerPhase, error)
}

// TraegerPhaseStore persists the Träger phases in the Träger transaction.
type TraegerPhaseStore interface {
	TraegerPhaseReads
	InsertTraegerPhase(ctx context.Context, organizationID int64, draft enrollment.TraegerPhaseFields, allSchools bool) (int64, error)
	UpdateTraegerPhaseDraft(ctx context.Context, organizationID, id int64, draft enrollment.TraegerPhaseFields, allSchools bool) (bool, error)
	ReplaceTraegerPhaseSchools(ctx context.Context, organizationID, id int64, schoolIDs []int64) error
	WithdrawTraegerPhase(ctx context.Context, organizationID, id int64) (bool, error)
	InsertTraegerPhaseVersion(ctx context.Context, organizationID, id int64, version int, fields enrollment.TraegerPhaseFields, accountID int64) error
	RecordTraegerPhaseOutcomes(ctx context.Context, organizationID, id int64, outcomes []enrollment.TraegerCopyOutcome) error
}

// TraegerPhases keeps the Träger phases (ADR 0195). It opens no transaction:
// the caller runs it in the Träger transaction of the Träger it names.
type TraegerPhases struct {
	TraegerPhaseReads
	store TraegerPhaseStore
	// today is the calendar day the service period bounds count from.
	today func() calendar.Date
}

var _ enrollment.TraegerPhases = (*TraegerPhases)(nil)

// NewTraegerPhases builds the Träger phases over their store; today bounds
// the service period of a draft (#5658).
func NewTraegerPhases(store TraegerPhaseStore, today func() calendar.Date) *TraegerPhases {
	if today == nil {
		panic("enrollment träger phases: the clock is required")
	}
	return &TraegerPhases{TraegerPhaseReads: store, store: store, today: today}
}

// CreateTraegerPhase validates the draft and creates the phase with its
// schools.
func (s *TraegerPhases) CreateTraegerPhase(ctx context.Context, organizationID int64, input enrollment.TraegerPhaseInput) (enrollment.TraegerPhase, error) {
	draft, schools, err := normalizeTraegerPhaseInput(input)
	if err != nil {
		return enrollment.TraegerPhase{}, err
	}
	if err := s.validateServicePeriodBounds(draft); err != nil {
		return enrollment.TraegerPhase{}, err
	}
	id, err := s.store.InsertTraegerPhase(ctx, organizationID, draft, input.AllSchools)
	if err != nil {
		return enrollment.TraegerPhase{}, err
	}
	if err := s.store.ReplaceTraegerPhaseSchools(ctx, organizationID, id, schools); err != nil {
		return enrollment.TraegerPhase{}, err
	}
	return s.store.TraegerPhase(ctx, organizationID, id)
}

// UpdateTraegerPhase replaces the draft and the schools of a phase that is
// not withdrawn, under the row lock and only over the version its author
// read (ADR 0311). No school notices before the next release.
func (s *TraegerPhases) UpdateTraegerPhase(ctx context.Context, organizationID, id int64, input enrollment.TraegerPhaseInput) (enrollment.TraegerPhase, error) {
	draft, schools, err := normalizeTraegerPhaseInput(input)
	if err != nil {
		return enrollment.TraegerPhase{}, err
	}
	current, err := s.store.LockTraegerPhase(ctx, organizationID, id)
	if err != nil {
		return enrollment.TraegerPhase{}, err
	}
	if err := readstate.Check(input.ExpectedVersion, current.Version); err != nil {
		return enrollment.TraegerPhase{}, err
	}
	if current.WithdrawnAt != nil {
		return enrollment.TraegerPhase{}, enrollment.ErrTraegerPhaseWithdrawn
	}
	// Like a school phase, a stored draft beyond the bounds stays editable
	// while its period stays as it is (#5658).
	if enrollment.ServicePeriodChanged(current.Draft.ServiceStartDate, current.Draft.ServiceEndDate, draft.ServiceStartDate, draft.ServiceEndDate) {
		if err := s.validateServicePeriodBounds(draft); err != nil {
			return enrollment.TraegerPhase{}, err
		}
	}
	if _, err := s.store.UpdateTraegerPhaseDraft(ctx, organizationID, id, draft, input.AllSchools); err != nil {
		return enrollment.TraegerPhase{}, err
	}
	if err := s.store.ReplaceTraegerPhaseSchools(ctx, organizationID, id, schools); err != nil {
		return enrollment.TraegerPhase{}, err
	}
	return s.store.TraegerPhase(ctx, organizationID, id)
}

// validateServicePeriodBounds keeps a draft within the bounds every school
// applies when it stores the copy (#5658).
func (s *TraegerPhases) validateServicePeriodBounds(draft enrollment.TraegerPhaseFields) error {
	if err := enrollment.ValidateServicePeriodBounds(draft.ServiceStartDate, draft.ServiceEndDate, s.today()); err != nil {
		return fmt.Errorf("%w: %w", enrollment.ErrInvalidPhase, err)
	}
	return nil
}

// WithdrawTraegerPhase marks the phase withdrawn.
func (s *TraegerPhases) WithdrawTraegerPhase(ctx context.Context, organizationID, id int64) (enrollment.TraegerPhase, error) {
	found, err := s.store.WithdrawTraegerPhase(ctx, organizationID, id)
	if err != nil {
		return enrollment.TraegerPhase{}, err
	}
	if !found {
		return enrollment.TraegerPhase{}, enrollment.ErrTraegerPhaseNotFound
	}
	return s.store.TraegerPhase(ctx, organizationID, id)
}

// ReleaseTraegerPhase writes the next version when the draft differs from
// the released one. A withdrawn phase keeps its last version.
func (s *TraegerPhases) ReleaseTraegerPhase(ctx context.Context, organizationID, id, accountID int64) (int, error) {
	phase, err := s.store.LockTraegerPhase(ctx, organizationID, id)
	if err != nil {
		return 0, err
	}
	released := 0
	if phase.ReleasedVersion != nil {
		released = *phase.ReleasedVersion
	}
	if phase.WithdrawnAt != nil || (phase.Released != nil && reflect.DeepEqual(*phase.Released, phase.Draft)) {
		return released, nil
	}
	if err := s.store.InsertTraegerPhaseVersion(ctx, organizationID, id, released+1, phase.Draft, accountID); err != nil {
		return 0, err
	}
	return released + 1, nil
}

// RecordTraegerPhaseOutcomes writes the outcome of each school's copy.
func (s *TraegerPhases) RecordTraegerPhaseOutcomes(ctx context.Context, organizationID, id int64, outcomes []enrollment.TraegerCopyOutcome) error {
	for _, outcome := range outcomes {
		if outcome.SchoolID <= 0 || !validTraegerOutcome(outcome.Outcome) {
			return fmt.Errorf("%w: outcome %q for school %d", enrollment.ErrInvalidPhase, outcome.Outcome, outcome.SchoolID)
		}
	}
	// The phase must exist for the Träger; a missing one is reported as
	// such, not as a foreign-key failure of the selection rows.
	if _, err := s.store.TraegerPhase(ctx, organizationID, id); err != nil {
		return err
	}
	return s.store.RecordTraegerPhaseOutcomes(ctx, organizationID, id, outcomes)
}

func validTraegerOutcome(outcome string) bool {
	switch outcome {
	case enrollment.TraegerOutcomeApplied, enrollment.TraegerOutcomeRejected, enrollment.TraegerOutcomeStale, enrollment.TraegerOutcomeWithdrawn:
		return true
	}
	return false
}

// normalizeTraegerPhaseInput fills the defaults of a school phase and runs
// the phase's own column rules, so a draft the office saves is a phase every
// school could store.
func normalizeTraegerPhaseInput(input enrollment.TraegerPhaseInput) (enrollment.TraegerPhaseFields, []int64, error) {
	fields := input.Fields
	fields.Name = strings.TrimSpace(fields.Name)
	fields.EnrollmentOpenAt = utcInstant(fields.EnrollmentOpenAt)
	fields.EnrollmentCloseAt = utcInstant(fields.EnrollmentCloseAt)
	if fields.Audience == "" {
		fields.Audience = enrollment.PhaseAudienceOpen
	}
	phase := traegerPhaseOf(fields)
	if err := phase.Validate(); err != nil {
		return fields, nil, fmt.Errorf("%w: %w", enrollment.ErrInvalidPhase, err)
	}
	fields.Kind = phase.Kind
	fields.CareOverflowMode = phase.CareOverflowMode
	fields.CareOfferingSelectionMode = phase.CareOfferingSelectionMode
	schools := make([]int64, 0, len(input.SchoolIDs))
	for _, id := range input.SchoolIDs {
		if id <= 0 {
			return fields, nil, fmt.Errorf("%w: school id must be positive", enrollment.ErrInvalidPhase)
		}
		if !slices.Contains(schools, id) {
			schools = append(schools, id)
		}
	}
	if input.AllSchools && len(schools) > 0 {
		return fields, nil, errors.Join(enrollment.ErrInvalidPhase, errors.New("all schools and a school list exclude each other"))
	}
	slices.Sort(schools)
	return fields, schools, nil
}

// utcInstant keeps an instant in UTC, so the same instant always compares
// and encodes the same way.
func utcInstant(instant *time.Time) *time.Time {
	if instant == nil {
		return nil
	}
	utc := instant.UTC()
	return &utc
}

// traegerPhaseOf is a school phase holding the Träger's fields, with the
// school's own fields empty.
func traegerPhaseOf(fields enrollment.TraegerPhaseFields) *enrollment.Phase {
	return &enrollment.Phase{
		Name: fields.Name, Kind: fields.Kind,
		ServiceStartDate: fields.ServiceStartDate, ServiceEndDate: fields.ServiceEndDate,
		EnrollmentOpenAt: fields.EnrollmentOpenAt, EnrollmentCloseAt: fields.EnrollmentCloseAt,
		Audience: fields.Audience, CareOverflowMode: fields.CareOverflowMode,
		CareOfferingSelectionMode: fields.CareOfferingSelectionMode, IsActive: fields.Active(),
		AvailableSchoolClasses: []string{}, EligibleSchoolClasses: []string{}, EligibleGradeLevels: []int{},
	}
}
