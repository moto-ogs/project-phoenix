package application

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The pickup person of one day (#7655). Service serves careplan.PickupPersons;
// the root binds it from the composed owner.
var _ careplan.PickupPersons = (*Service)(nil)

// ListDayPickups reads the Abholart and pickup person of the days from from
// to to. A nil studentIDs reads the whole school, an empty one reads
// nothing. Readers of the day itself (group view, "Heute anders") pass
// their today; a reader of other days hides the persons of past days, which
// the nightly retention deletes (#7655).
func (s *Service) ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]careplan.DayPickup, error) {
	if from.IsZero() || !to.IsZero() && to.Before(from) {
		return nil, scheduleInvalid()
	}
	if studentIDs != nil {
		// An empty list reads nothing and opens no transaction.
		if studentIDs = uniquePositive(studentIDs); len(studentIDs) == 0 {
			return []careplan.DayPickup{}, nil
		}
	}
	started := time.Now()
	rows, stats, err := scopedRecordRead(ctx, func(txCtx context.Context) ([]careplan.DayPickup, domain.OperationStats, error) {
		return s.pickupPersons.ListDayPickups(txCtx, from, to, studentIDs)
	})
	s.observeRequest("list_day_pickups", time.Since(started), stats, err)
	return rows, err
}

// SetPickupPerson validates the value, takes the care-day lock every writer
// of the child's day shares and replaces the day's pickup person. A named
// contact's permission row is locked and checked before the upsert, so a
// concurrent withdrawal either commits first and refuses the write or waits
// until the day value commits.
func (s *Service) SetPickupPerson(ctx context.Context, person careplan.PickupPerson, staffID int64, guardian *careplan.PickupPersonGuardianAuthorization) (careplan.PickupPerson, error) {
	date, err := s.pickupPersonDay(ctx, person.StudentID, person.ExceptionDate)
	if err != nil {
		return careplan.PickupPerson{}, err
	}
	person, err = validatedPickupPerson(person, guardian)
	if err != nil {
		return careplan.PickupPerson{}, err
	}
	person.CreatedBy = optionalStaff(staffID)
	return s.savePickupPerson(ctx, person, date, guardian)
}

// SaveApprovedPickupPerson writes the pickup person a family named in its
// one-day request, as the OGS approval decided it (#8162). The approval holds
// the care-day lock and rechecked a named contact itself: the signed request
// grants the contact the one day, so no standing permission is needed.
func (s *Service) SaveApprovedPickupPerson(ctx context.Context, person careplan.PickupPerson) (careplan.PickupPerson, error) {
	person.Name = strings.Join(strings.Fields(person.Name), " ")
	if person.StudentID <= 0 || person.ExceptionDate == "" || person.Name == "" ||
		utf8.RuneCountInString(person.Name) > careplan.PickupPersonNameMaxLength ||
		person.GuardianProfileID != nil && *person.GuardianProfileID <= 0 {
		return careplan.PickupPerson{}, careplan.ErrPickupPersonInvalid
	}
	var saved careplan.PickupPerson
	err := s.run(ctx, "save_approved_pickup_person", func(txCtx context.Context, stats *domain.OperationStats) error {
		var err error
		saved, *stats, err = s.pickupPersons.SavePickupPerson(txCtx, person)
		return err
	})
	return saved, err
}

// DeleteApprovedPickupPerson deletes the one row a corrected approval wrote
// (#8162) under the care-day lock. The correction checked that the row is
// still as the approval left it; a past day is no refusal here, its value is
// gone or about to be.
func (s *Service) DeleteApprovedPickupPerson(ctx context.Context, studentID int64, date calendar.Date, id int64) (bool, error) {
	if studentID <= 0 || date.IsZero() || id <= 0 {
		return false, careplan.ErrPickupPersonInvalid
	}
	deleted := false
	err := s.run(ctx, "delete_approved_pickup_person", func(txCtx context.Context, stats *domain.OperationStats) error {
		if err := s.LockStudentAndExceptionDay(txCtx, studentID, date.String()); err != nil {
			return err
		}
		var err error
		deleted, *stats, err = s.pickupPersons.DeletePickupPersonByID(txCtx, id)
		return err
	})
	return deleted, err
}

func validatedPickupPerson(person careplan.PickupPerson, guardian *careplan.PickupPersonGuardianAuthorization) (careplan.PickupPerson, error) {
	person.Name = strings.Join(strings.Fields(person.Name), " ")
	if person.Name == "" || utf8.RuneCountInString(person.Name) > careplan.PickupPersonNameMaxLength ||
		person.GuardianProfileID != nil && *person.GuardianProfileID <= 0 {
		return careplan.PickupPerson{}, careplan.ErrPickupPersonInvalid
	}
	if person.GuardianProfileID == nil && guardian != nil || person.GuardianProfileID != nil &&
		(guardian == nil || guardian.RelationshipID <= 0 || guardian.Weekday < 1 || guardian.Weekday > 5) {
		return careplan.PickupPerson{}, careplan.ErrPickupPersonInvalid
	}
	return person, nil
}

func (s *Service) savePickupPerson(ctx context.Context, person careplan.PickupPerson, date calendar.Date, guardian *careplan.PickupPersonGuardianAuthorization) (careplan.PickupPerson, error) {
	var saved careplan.PickupPerson
	err := s.run(ctx, "save_pickup_person", func(txCtx context.Context, stats *domain.OperationStats) error {
		if err := s.LockStudentAndExceptionDay(txCtx, person.StudentID, date.String()); err != nil {
			return err
		}
		if err := s.authorizePickupPersonGuardian(txCtx, stats, guardian); err != nil {
			return err
		}
		var err error
		saved, *stats, err = s.pickupPersons.SavePickupPerson(txCtx, person)
		return err
	})
	return saved, err
}

func (s *Service) authorizePickupPersonGuardian(ctx context.Context, stats *domain.OperationStats, guardian *careplan.PickupPersonGuardianAuthorization) error {
	if guardian == nil {
		return nil
	}
	allowed, permissionStats, err := s.pickupPersons.LockGuardianPickupPermission(ctx, guardian.RelationshipID, guardian.Weekday)
	stats.Add(permissionStats)
	if err != nil {
		return err
	}
	if !allowed {
		return careplan.ErrPickupPersonGuardianNotAuthorized
	}
	return nil
}

// DeletePickupPerson removes the day's pickup person under the care-day
// lock. A past day is refused like a write: its value is gone or about to be.
func (s *Service) DeletePickupPerson(ctx context.Context, studentID int64, date calendar.Date) (bool, error) {
	if _, err := s.pickupPersonDay(ctx, studentID, careplan.Date(date)); err != nil {
		return false, err
	}
	deleted := false
	err := s.run(ctx, "delete_pickup_person", func(txCtx context.Context, stats *domain.OperationStats) error {
		if err := s.LockStudentAndExceptionDay(txCtx, studentID, date.String()); err != nil {
			return err
		}
		var err error
		deleted, *stats, err = s.pickupPersons.DeletePickupPerson(txCtx, studentID, date)
		return err
	})
	return deleted, err
}

// pickupPersonDay checks the child and the day: today or later, and a care
// weekday of the school.
func (s *Service) pickupPersonDay(ctx context.Context, studentID int64, day careplan.Date) (calendar.Date, error) {
	date, err := calendar.ParseDate(string(day))
	if studentID <= 0 || err != nil {
		return "", careplan.ErrPickupPersonInvalid
	}
	if date.Before(s.today()) {
		return "", careplan.ErrPickupPersonPastDate
	}
	careDay, err := calendar.IsCareWeekday(ctx, date)
	if err != nil {
		return "", &careplan.ScheduleError{Op: "pickup person day", Err: err}
	}
	if !careDay {
		return "", careplan.ErrPickupPersonNotCareDay
	}
	return date, nil
}
