package application

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type PickupApprovals struct {
	People      ports.PickupApprovalDirectory
	Presence    ports.PickupApprovalPresence
	Exceptions  ports.PickupApprovalExceptions
	Excusal     ports.PickupApprovalExcusal
	Locker      ports.PickupApprovalLocker
	Persons     ports.PickupApprovalPersons
	Today       func() calendar.Date
	Fingerprint func([]byte) string
}

var _ carerequests.PickupApprovals = (*PickupApprovals)(nil)

func (s *PickupApprovals) ApplyPickupApproval(ctx context.Context, input carerequests.PickupApproval) (carerequests.PickupApplied, error) {
	change, err := carerequests.ParsePickup(input.Payload)
	if err != nil {
		return carerequests.PickupApplied{}, err
	}
	if change.DepartureMode != "" || change.PickupPerson != nil {
		careDay, careDayErr := calendar.IsCareWeekday(ctx, change.Date)
		if careDayErr != nil {
			return carerequests.PickupApplied{}, fmt.Errorf("schedule: resolve weekend plan for pickup request decision: %w", careDayErr)
		}
		if !careDay {
			return carerequests.PickupApplied{}, careplan.ErrDepartureExceptionNotCareDay
		}
	}
	if err := s.lockApprovalDay(ctx, input, change); err != nil {
		return carerequests.PickupApplied{}, err
	}
	return s.applyLegs(ctx, input, change)
}

// lockApprovalDay refuses a past or post-enrollment day, takes the care-day
// lock and runs the checks that need it: the reviewed impact of a new time,
// and that the child has not already gone home today.
func (s *PickupApprovals) lockApprovalDay(ctx context.Context, input carerequests.PickupApproval, change carerequests.PickupChange) error {
	date := change.Date
	if date.Before(s.Today()) {
		return carerequests.ErrPickupChangeExpired
	}
	until, err := s.People.EnrolledUntil(ctx, input.StudentID)
	if err != nil {
		return fmt.Errorf("schedule: reload student for pickup request decision: %w", err)
	}
	if until != nil && date.After(*until) {
		return careplan.ErrCareScheduleRequestNotFound
	}
	if err := s.Locker.LockStudentAndExceptionDay(ctx, input.StudentID, date.String()); err != nil {
		return fmt.Errorf("schedule: lock pickup request care day: %w", err)
	}
	if change.PickupTime != nil {
		if err := s.verifyImpact(ctx, input, date, *change.PickupTime); err != nil {
			return err
		}
	}
	if change.PickupPerson != nil && change.DepartureMode == "" {
		if err := s.ensurePickupPersonDepartureAllowed(ctx, input.StudentID, date); err != nil {
			return err
		}
	}
	return s.ensureNotCompleted(ctx, input.StudentID, date)
}

// ensurePickupPersonDepartureAllowed resolves the day mode before the weekly
// plan. The request check uses the same order; the approval repeats it because
// the weekly plan can change while a request waits for review.
func (s *PickupApprovals) ensurePickupPersonDepartureAllowed(ctx context.Context, studentID int64, date calendar.Date) error {
	departure, err := s.Exceptions.FindDepartureForDate(ctx, studentID, date)
	if err != nil {
		return fmt.Errorf("schedule: load departure exception for pickup person request: %w", err)
	}
	if departure != nil {
		if !carerequests.PickupPersonAllowed(departure.DepartureMode) {
			return carerequests.ErrPickupChangeConflict
		}
		return nil
	}
	weekday, err := calendar.PlanWeekday(ctx, date)
	if err != nil {
		return fmt.Errorf("schedule: resolve plan weekday for pickup person request: %w", err)
	}
	if weekday < 1 || weekday > 5 {
		return carerequests.ErrPickupChangeConflict
	}
	weekly, err := s.People.WeeklyDepartureModes(ctx, studentID)
	if err != nil {
		return fmt.Errorf("schedule: resolve weekly departure modes for pickup person request: %w", err)
	}
	modes := weekly[planWeekdayKeys[weekday]]
	if len(modes) == 0 {
		modes = []string{careplan.DepartureModeAlone}
	}
	for _, mode := range modes {
		if !carerequests.PickupPersonAllowed(mode) {
			return carerequests.ErrPickupChangeConflict
		}
	}
	return nil
}

// applyLegs writes the requested Gehzeit and Abholart (#3945) of the day in
// the name of the deciding staff member. Each leg returns the version of its
// row as this transaction leaves it, for the decision ledger.
func (s *PickupApprovals) applyLegs(ctx context.Context, input carerequests.PickupApproval, change carerequests.PickupChange) (carerequests.PickupApplied, error) {
	var applied carerequests.PickupApplied
	staffID, err := actingStaffID(ctx, s.People, pickupRequestStaff)
	if err != nil {
		return applied, err
	}
	if change.PickupTime != nil {
		if applied.PickupExceptionID, applied.PickupExceptionVersion, err = s.applyPickupTime(ctx, input, change, staffID); err != nil {
			return applied, err
		}
	}
	if change.DepartureMode != "" {
		if applied.DepartureExceptionID, applied.DepartureExceptionVersion, err = s.applyDepartureMode(ctx, input, change, staffID); err != nil {
			return applied, err
		}
	}
	if change.PickupPerson != nil {
		if applied.PickupPersonID, applied.PickupPersonVersion, err = s.applyPickupPerson(ctx, input, change, staffID); err != nil {
			return applied, err
		}
	}
	return applied, nil
}

func (s *PickupApprovals) applyPickupTime(ctx context.Context, input carerequests.PickupApproval, change carerequests.PickupChange, staffID int64) (int64, string, error) {
	id, err := s.SaveApprovedException(ctx, input.TenantID, input.StudentID, change.Date, *change.PickupTime, change.Reason, staffID)
	if err != nil {
		return 0, "", err
	}
	if err := s.Excusal.Sync(ctx, id); err != nil {
		return 0, "", fmt.Errorf("schedule: sync approved pickup exception: %w", err)
	}
	row, err := s.Exceptions.FindForDate(ctx, input.StudentID, change.Date)
	if err == nil && row == nil {
		err = careplan.ErrStudentScheduleNotFound
	}
	if err != nil {
		return 0, "", fmt.Errorf("schedule: read back approved pickup exception: %w", err)
	}
	return id, pickupExceptionVersion(*row), nil
}

func (s *PickupApprovals) applyDepartureMode(ctx context.Context, input carerequests.PickupApproval, change carerequests.PickupChange, staffID int64) (int64, string, error) {
	id, err := s.saveApprovedDeparture(ctx, input.StudentID, change.Date, change.DepartureMode, change.Reason, staffID)
	if err != nil {
		return 0, "", err
	}
	row, err := s.Exceptions.FindDepartureForDate(ctx, input.StudentID, change.Date)
	if err == nil && row == nil {
		err = careplan.ErrStudentScheduleNotFound
	}
	if err != nil {
		return 0, "", fmt.Errorf("schedule: read back approved departure exception: %w", err)
	}
	return id, departureExceptionVersion(*row), nil
}

// applyPickupPerson writes the approval's last row: the day's pickup person
// (#8162), the one value the group view, "Heute anders" and the day lists
// show for who collects the child. Before #8162 the approval wrote a dated
// pickup note; corrections still take those back. A named contact is
// rechecked under its lock; a one-time person has only the name. A pickup
// person the OGS set for the day wins, as for the Abholart; one an earlier
// approved request named is replaced.
func (s *PickupApprovals) applyPickupPerson(ctx context.Context, input carerequests.PickupApproval, change carerequests.PickupChange, staffID int64) (int64, string, error) {
	person := careplan.PickupPerson{
		TenantID: input.TenantID, StudentID: input.StudentID, ExceptionDate: careplan.Date(change.Date),
		Name: change.PickupPerson.Name, CreatedBy: optionalStaff(staffID),
	}
	if input.GuardianAccountID > 0 {
		requester := input.GuardianAccountID
		person.RequestedByGuardian = &requester
	}
	if !change.PickupPerson.OneTime() {
		if err := s.People.ValidatePickupPerson(ctx, input.StudentID, change.PickupPerson.GuardianProfileID); err != nil {
			return 0, "", err
		}
		contact := change.PickupPerson.GuardianProfileID
		person.GuardianProfileID = &contact
	}
	existing, err := dayPickupPerson(ctx, s.Persons, input.StudentID, change.Date)
	if err != nil {
		return 0, "", fmt.Errorf("schedule: load pickup person for request: %w", err)
	}
	if existing != nil && existing.RequestedByGuardian == nil {
		return 0, "", carerequests.ErrPickupChangeConflict
	}
	saved, err := s.Persons.SaveApprovedPickupPerson(ctx, person)
	if err != nil {
		return 0, "", fmt.Errorf("schedule: save approved pickup person: %w", err)
	}
	stored, err := dayPickupPerson(ctx, s.Persons, input.StudentID, change.Date)
	if err == nil && stored == nil {
		err = careplan.ErrStudentScheduleNotFound
	}
	if err != nil {
		return 0, "", fmt.Errorf("schedule: read back approved pickup person: %w", err)
	}
	return saved.ID, pickupPersonVersion(*stored), nil
}

// saveApprovedDeparture writes the requested Abholart of the day. A value the
// OGS already set for that day wins, exactly like a staff pickup exception:
// the parent's request may not silently replace it.
func (s *PickupApprovals) saveApprovedDeparture(ctx context.Context, studentID int64, date calendar.Date, mode, reason string, staffID int64) (int64, error) {
	existing, err := s.Exceptions.FindDepartureForDate(ctx, studentID, date)
	if err != nil {
		return 0, fmt.Errorf("schedule: load departure exception for request: %w", err)
	}
	if existing != nil {
		return 0, carerequests.ErrPickupChangeConflict
	}
	id, err := s.Exceptions.SaveDeparture(ctx, careplan.DepartureException{
		StudentID: studentID, ExceptionDate: careplan.Date(date), DepartureMode: mode, Reason: &reason,
		CreatedBy: optionalStaff(staffID), EnteredByTraeger: careplan.EnteredByTraeger(ctx, staffID),
	})
	if err != nil {
		return 0, fmt.Errorf("schedule: save approved departure exception: %w", err)
	}
	return id, nil
}

func (s *PickupApprovals) verifyImpact(ctx context.Context, input carerequests.PickupApproval, date calendar.Date, pickup time.Time) error {
	if input.ExpectedImpactToken == nil {
		if input.RequireImpactToken {
			return carerequests.ErrPickupChangeImpactRequired
		}
		return nil
	}
	blocks, err := s.Excusal.Preview(ctx, input.StudentID, date, pickup)
	if err != nil {
		return fmt.Errorf("schedule: verify pickup request impact: %w", err)
	}
	if s.Fingerprint(carerequests.PickupImpactContent(blocks)) != *input.ExpectedImpactToken {
		return carerequests.ErrPickupChangeImpactChanged
	}
	return nil
}

func (s *PickupApprovals) ensureNotCompleted(ctx context.Context, studentID int64, date calendar.Date) error {
	if date != s.Today() {
		return nil
	}
	if err := s.Presence.LockStudentAttendance(ctx, studentID); err != nil {
		return fmt.Errorf("schedule: lock attendance for pickup request: %w", err)
	}
	open, completed, err := s.Presence.AttendanceCompletion(ctx, studentID, date)
	if err != nil {
		return fmt.Errorf("schedule: load attendance for pickup request: %w", err)
	}
	if completed && !open {
		return carerequests.ErrPickupChangeAlreadyCompleted
	}
	return nil
}

// SaveApprovedException is shared by approvals and staff conflict resolutions.
// Both callers hold the owner care-day lock in the ambient tenant transaction.
func (s *PickupApprovals) SaveApprovedException(ctx context.Context, tenantID, studentID int64, date calendar.Date, pickup time.Time, reason string, staffID int64) (int64, error) {
	existing, err := s.Exceptions.FindForDate(ctx, studentID, date)
	if err != nil {
		return 0, fmt.Errorf("schedule: load pickup exception for request: %w", err)
	}
	if existing != nil {
		if careplan.SchoolOwnedException(existing.Source) || (existing.ExcusedFrom != nil && !existing.ExcusedAuto) {
			return 0, carerequests.ErrPickupChangeConflict
		}
		clock := calendar.NormalizeWallClock(pickup)
		existing.PickupTime = &clock
		existing.Reason = &reason
		existing.Source = careplan.ExceptionSourceStaff
		existing.CreatedBy, existing.EnteredByTraeger = staffID, careplan.EnteredByTraeger(ctx, staffID)
		existing.CreatedByGuardian = nil
		if existing.ExcusedFrom != nil {
			excused := calendar.NormalizeWallClock(*existing.ExcusedFrom)
			existing.ExcusedFrom = &excused
		}
		if err := s.Exceptions.Update(ctx, *existing); err != nil {
			return 0, fmt.Errorf("schedule: update approved pickup exception: %w", err)
		}
		return existing.ID, nil
	}
	id, err := s.Exceptions.Create(ctx, careplan.PickupException{
		TenantID: tenantID, StudentID: studentID, ExceptionDate: careplan.Date(date),
		PickupTime: &pickup, Reason: &reason, Source: careplan.ExceptionSourceStaff, CreatedBy: staffID,
		EnteredByTraeger: careplan.EnteredByTraeger(ctx, staffID),
	})
	if err != nil {
		if s.Exceptions.IsUniqueViolation(err) {
			return 0, carerequests.ErrPickupChangeConflict
		}
		return 0, fmt.Errorf("schedule: create approved pickup exception: %w", err)
	}
	return id, nil
}
