package care

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/careplan/absencerecords"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// careExceptionChange is one guardian pickup change for a day.
type careExceptionChange struct {
	accountID int64
	studentID int64
	date      calendar.Date
	today     calendar.Date
}

// lockCareDay locks the child's row, re-checks the care interval under that
// lock, and takes the care-day lock every day-exception writer shares.
func (s *Service) lockCareDay(ctx context.Context, studentID int64, date calendar.Date) error {
	student, err := s.StudentRepo.FindByIDForUpdate(ctx, studentID)
	if err != nil {
		return err
	}
	if student.CareEndedOn(s.todayDate()) {
		return ErrChildCareEnded
	}
	return s.CareExceptions.LockStudentAndExceptionDay(ctx, studentID, date.String())
}

// guardTodayPickupOpen refuses a guardian change to today's pickup once the
// child has left for the day, or once the school's care day has ended
// (the changed opening-day closing time or operations.session_end_time, #5710):
// a child still in class then goes home straight from school, so a new pickup
// time would describe nothing. The end of the care day is the same rule that
// ends "Im Unterricht"
// (carerequests.CareDayEnded). It is read in the caller's tenant transaction
// after the day's locks, like the cutoff. Later days stay open.
func (s *Service) guardTodayPickupOpen(ctx context.Context, tenantID, studentID int64, date, today calendar.Date) error {
	if date != today {
		return nil
	}
	alreadyLeft, err := s.childAlreadyLeftToday(ctx, studentID, date, today)
	if err != nil {
		return err
	}
	if alreadyLeft {
		return ErrCareExceptionAlreadyLeft
	}
	careDayEnd, err := s.careDayEndToday(ctx, tenantID, today)
	if err != nil {
		return err
	}
	if carerequests.CareDayEnded(careDayEnd, s.now()) {
		return ErrPickupChangeCareDayEnded
	}
	return nil
}

// careDayEndToday is the school's care day end of today: the closing time of
// a changed opening day (#8157), otherwise operations.session_end_time.
func (s *Service) careDayEndToday(ctx context.Context, tenantID int64, today calendar.Date) (string, error) {
	if s.ClosingTimes != nil {
		closesAt, ok, err := s.ClosingTimes(ctx, today)
		if err != nil {
			return "", fmt.Errorf("parent: read the closing time of today: %w", err)
		}
		if ok {
			return closesAt, nil
		}
	}
	careDayEnd, err := s.Settings.ResolveStringForTenantInTx(ctx, tenantID, KeySessionEndTime)
	if err != nil {
		return "", fmt.Errorf("parent: resolve care day end: %w", err)
	}
	return careDayEnd, nil
}

func (s *Service) childAlreadyLeftToday(ctx context.Context, studentID int64, date, today calendar.Date) (bool, error) {
	if date != today || s.Attendance == nil {
		return false, nil
	}
	rows, err := s.Attendance.ListAttendance(ctx, AttendanceFilter{StudentIDs: []int64{studentID}, FromDate: date.String(), UntilDate: date.String()})
	if err != nil {
		return false, err
	}
	return AttendanceRowsShowLeft(rows), nil
}

// Only the PICKUP leg of the day can block a parent: since arrival times became
// OGS-only, a staff-set Bringzeit says nothing about who owns the Abholzeit, and
// treating it as a conflict would let one OGS entry silently forbid every parent
// pickup change for that day.
// An AUTO-derived partial absence is the school's own bookkeeping, not a
// decision, so only a manual one counts (#2360).
func (s *Service) pickupHasStaffException(ctx context.Context, studentID int64, date calendar.Date) (bool, error) {
	pickup, err := s.pickupExceptionForDate(ctx, studentID, calendar.Date(date))
	if err != nil {
		return false, err
	}
	return pickup != nil && (schoolOwned(pickup.Source) || pickup.HasManualPartialAbsence()), nil
}

// DeleteCareException removes only the guardian-authored pickup exception for
// the date. Arrival and staff rows are left untouched. Deleting a day with
// nothing guardian-owned
// is a no-op (and skips the broadcast). Not gated by the feature toggle for the
// same reason as ListCareExceptions: clearing one's own override stays available.
func (s *Service) DeleteCareException(ctx context.Context, accountID, studentID int64, date calendar.Date) error {
	child, err := s.ResolvePermittedChild(ctx, accountID, studentID, GuardianPermissionPickupManage)
	if err != nil {
		return err
	}
	// A child whose care at this school has ended keeps read access to
	// what happened, but nothing new can be submitted for them (#2487).
	if err := child.RequireOGSCareRunning(); err != nil {
		return err
	}

	today := s.todayDate()
	if date.Before(today) {
		return ErrPastCareDate
	}
	change := careExceptionChange{accountID: accountID, studentID: studentID, date: date, today: today}
	txErr := s.WithChildWrite(ctx, accountID, studentID, child, childWriteNeeds(GuardianPermissionPickupManage), func(txCtx context.Context) error {
		return s.withdrawCareException(txCtx, child.TenantID, change)
	})
	if txErr != nil {
		return fmt.Errorf("parent: delete care exception: %w", txErr)
	}
	return nil
}

// withdrawCareException removes the guardian's pickup row of the day. Removing
// an approved exception takes effect at once, without a staff decision, so
// after the school's cutoff it is closed for today like every other guardian
// pickup write (#3163).
func (s *Service) withdrawCareException(ctx context.Context, tenantID int64, change careExceptionChange) error {
	if err := s.lockCareDay(ctx, change.studentID, change.date); err != nil {
		return err
	}
	if err := s.guardTodayPickupOpen(ctx, tenantID, change.studentID, change.date, change.today); err != nil {
		return err
	}
	pickup, err := s.pickupExceptionForDate(ctx, change.studentID, calendar.Date(change.date))
	if err != nil || pickup == nil {
		return err
	}
	if pickup.HasManualPartialAbsence() {
		return ErrCareExceptionConflict
	}
	if pickup.Source != exceptionSourceGuardian {
		return nil
	}
	cutoff, err := s.pickupChangeCutoffInTx(ctx, tenantID)
	if err != nil {
		return err
	}
	if err := s.guardTodayPickupOpen(ctx, tenantID, change.studentID, change.date, change.today); err != nil {
		return err
	}
	if cutoff.Closed(change.date) {
		return ErrPickupChangeCutoffPassed
	}
	// An auto-derived excusal follows the pickup time: Care Plan releases the
	// excused blocks before the row is removed (#2360).
	if err := s.GuardianPickups.WithdrawGuardianPickupException(ctx, *pickup); err != nil {
		return err
	}
	pillBody := "Korrektur: Abholung " + change.date.Format("02.01.") + " zurückgezogen"
	if err := s.SelfService.EmitSelfServicePill(ctx, tenantID, change.studentID, change.accountID, "care_exception_correction", pillBody, "", nil); err != nil {
		return err
	}
	s.Runtime.RegisterAfterCommit(ctx, func() {
		s.broadcastStudentUpdated(tenantID, change.studentID)
		// Fan out to EVERY guardian so a co-guardian's open tab drops the
		// removed override on the "Heute" tile live (#1725 review).
		s.SelfService.WakeChildGuardians(tenantID, change.studentID)
	})
	return nil
}

// broadcastStudentUpdated fires a tenant-scoped student_updated event so
// supervisors' live views refresh after a parent-side change. Mirrors the
// staff handler's broadcast; fire-and-forget.
func (s *Service) broadcastStudentUpdated(tenantID, studentID int64) {
	if s.StudentUpdates == nil || tenantID <= 0 {
		return
	}
	if err := s.StudentUpdates.StudentUpdated(tenantID, absencerecords.StudentStatusSourceParent); err != nil {
		s.Logger.Warn("parent: failed to broadcast student update",
			slog.Int64("tenant_id", tenantID),
			slog.Int64("student_id", studentID),
			slog.String("error", err.Error()),
		)
	}
}
