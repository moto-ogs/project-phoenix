package application

import (
	"context"
	"errors"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Opening changes of a Träger (#8202). The caller runs every operation in
// the Träger transaction of organizationID; the store refuses any other
// unit. The rules of a change are the school's (domain.NormalizeOpeningChange);
// the Träger names the schools, which must be its undeleted schools.

// TraegerOpeningChangeStore persists the opening changes of one Träger.
type TraegerOpeningChangeStore interface {
	ListTraegerOpeningChanges(ctx context.Context, organizationID int64, from, to calendar.Date) ([]domain.TraegerOpeningChange, error)
	InsertTraegerOpeningChange(ctx context.Context, organizationID int64, fields domain.TraegerOpeningChangeFields) (domain.TraegerOpeningChange, error)
	// LockTraegerOpeningChange reads a change and holds it until the Träger
	// transaction ends: the version a write replaces.
	LockTraegerOpeningChange(ctx context.Context, organizationID, id int64) (domain.TraegerOpeningChange, error)
	UpdateTraegerOpeningChange(ctx context.Context, organizationID, id int64, fields domain.TraegerOpeningChangeFields) (domain.TraegerOpeningChange, error)
	DeleteTraegerOpeningChange(ctx context.Context, organizationID, id int64) error
}

// TraegerOpeningChanges serves traegercalendar.OpeningChanges.
type TraegerOpeningChanges struct {
	store   TraegerOpeningChangeStore
	schools traegercalendar.Schools
}

var _ traegercalendar.OpeningChanges = (*TraegerOpeningChanges)(nil)

// NewTraegerOpeningChanges builds the Träger's opening changes over store;
// schools names the Träger's undeleted schools.
func NewTraegerOpeningChanges(store TraegerOpeningChangeStore, schools traegercalendar.Schools) *TraegerOpeningChanges {
	if store == nil || schools == nil {
		panic("school calendar: the Träger opening change store and the Träger's schools are required")
	}
	return &TraegerOpeningChanges{store: store, schools: schools}
}

// ListOpeningChanges lists the Träger's changes touching [from, to].
func (t *TraegerOpeningChanges) ListOpeningChanges(ctx context.Context, organizationID int64, from, to calendar.Date) ([]traegercalendar.OpeningChange, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	if problem := domain.OpeningChangeRange(from, to, domain.OpeningChangeWindowMaxDays, "to"); problem != nil {
		return nil, invalidTraegerOpeningChange(problem)
	}
	changes, err := t.store.ListTraegerOpeningChanges(ctx, organizationID, from, to)
	if err != nil {
		return nil, err
	}
	result := make([]traegercalendar.OpeningChange, 0, len(changes))
	for _, change := range changes {
		result = append(result, traegerOpeningChange(change))
	}
	return result, nil
}

// CreateOpeningChange adds a change for the named schools.
func (t *TraegerOpeningChanges) CreateOpeningChange(ctx context.Context, organizationID int64, input traegercalendar.OpeningChangeInput) (traegercalendar.OpeningChange, error) {
	if organizationID <= 0 {
		return traegercalendar.OpeningChange{}, errTraegerRequired
	}
	schools, err := t.schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return traegercalendar.OpeningChange{}, err
	}
	fields, err := checkedTraegerOpeningChange(input, schools)
	if err != nil {
		return traegercalendar.OpeningChange{}, err
	}
	change, err := t.store.InsertTraegerOpeningChange(ctx, organizationID, fields)
	if err != nil {
		return traegercalendar.OpeningChange{}, traegerOpeningChangeError(err)
	}
	return traegerOpeningChange(change), nil
}

// UpdateOpeningChange replaces a change of the Träger in the version it read.
func (t *TraegerOpeningChanges) UpdateOpeningChange(ctx context.Context, organizationID, id int64, input traegercalendar.OpeningChangeInput) (traegercalendar.OpeningChange, error) {
	if organizationID <= 0 {
		return traegercalendar.OpeningChange{}, errTraegerRequired
	}
	if id <= 0 {
		return traegercalendar.OpeningChange{}, traegercalendar.ErrOpeningChangeNotFound
	}
	schools, err := t.schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return traegercalendar.OpeningChange{}, err
	}
	fields, err := checkedTraegerOpeningChange(input, schools)
	if err != nil {
		return traegercalendar.OpeningChange{}, err
	}
	previous, err := t.store.LockTraegerOpeningChange(ctx, organizationID, id)
	if err != nil {
		return traegercalendar.OpeningChange{}, traegerOpeningChangeError(err)
	}
	if err := readstate.Check(input.ExpectedVersion, readstate.Of(previous.UpdatedAt)); err != nil {
		return traegercalendar.OpeningChange{}, err
	}
	return storedTraegerOpeningChange(t.store.UpdateTraegerOpeningChange(ctx, organizationID, id, fields))
}

// DeleteOpeningChange removes a change of the Träger under its row lock; the
// named schools count it no longer from the next read on.
func (t *TraegerOpeningChanges) DeleteOpeningChange(ctx context.Context, organizationID, id int64) error {
	if organizationID <= 0 {
		return errTraegerRequired
	}
	if id <= 0 {
		return traegercalendar.ErrOpeningChangeNotFound
	}
	// The lock refuses a change of another Träger before the delete runs.
	if _, err := t.store.LockTraegerOpeningChange(ctx, organizationID, id); err != nil {
		return traegerOpeningChangeError(err)
	}
	return traegerOpeningChangeError(t.store.DeleteTraegerOpeningChange(ctx, organizationID, id))
}

// checkedTraegerOpeningChange normalizes input and refuses a school that is
// not among schools, the Träger's undeleted schools, before anything is
// written. The database trigger keeps the same rule for a school deleted in
// between.
func checkedTraegerOpeningChange(input traegercalendar.OpeningChangeInput, schools []traegercalendar.SchoolState) (domain.TraegerOpeningChangeFields, error) {
	fields, problem := domain.NormalizeOpeningChange(domain.OpeningChangeFields{
		StartDate: input.StartDate, EndDate: input.EndDate, OpensAt: input.OpensAt, ClosesAt: input.ClosesAt, Reason: input.Reason,
	}, schoolcalendar.OpeningChangeReasonMaxLength)
	if problem != nil {
		return domain.TraegerOpeningChangeFields{}, invalidTraegerOpeningChange(problem)
	}
	schoolIDs := slices.Clone(input.SchoolIDs)
	slices.Sort(schoolIDs)
	schoolIDs = slices.Compact(schoolIDs)
	if len(schoolIDs) == 0 {
		return domain.TraegerOpeningChangeFields{}, invalidTraegerOpeningChange(&domain.OpeningChangeProblem{Field: "school_ids", Reason: "at least one school is required"})
	}
	for _, id := range schoolIDs {
		if !slices.ContainsFunc(schools, func(school traegercalendar.SchoolState) bool { return school.ID == id }) {
			return domain.TraegerOpeningChangeFields{}, traegercalendar.ErrSchoolOutside
		}
	}
	return domain.TraegerOpeningChangeFields{OpeningChangeFields: fields, SchoolIDs: schoolIDs}, nil
}

func traegerOpeningChange(change domain.TraegerOpeningChange) traegercalendar.OpeningChange {
	return traegercalendar.OpeningChange{
		ID: ident.ID(change.ID), StartDate: change.StartDate, EndDate: change.EndDate, OpensAt: change.OpensAt, ClosesAt: change.ClosesAt,
		Reason: change.Reason, SchoolIDs: ident.IDs(change.SchoolIDs), Version: readstate.Of(change.UpdatedAt),
	}
}

func storedTraegerOpeningChange(change domain.TraegerOpeningChange, err error) (traegercalendar.OpeningChange, error) {
	if err != nil {
		return traegercalendar.OpeningChange{}, traegerOpeningChangeError(err)
	}
	return traegerOpeningChange(change), nil
}

// traegerOpeningChangeError names the store's refusals in the contract.
func traegerOpeningChangeError(err error) error {
	switch {
	case errors.Is(err, domain.ErrTraegerOpeningChangeNotFound):
		return traegercalendar.ErrOpeningChangeNotFound
	case errors.Is(err, domain.ErrTraegerOpeningChangeSchoolOutside):
		return traegercalendar.ErrSchoolOutside
	}
	return err
}

func invalidTraegerOpeningChange(problem *domain.OpeningChangeProblem) error {
	return &traegercalendar.InvalidOpeningChangeError{Field: problem.Field, Reason: problem.Reason}
}
