package application

import (
	"context"

	scheduleModel "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// staffNoticePushDays is how far ahead a cancellation still rings a phone
// (#7148): from today up to 14 days ahead. A later one reaches the
// notification feed only; a past one nobody.
const staffNoticePushDays = 14

// noticeStaffOfCancellation tells the staff planned for the block that it was
// cancelled (#7148), in the cancellation's transaction. Planned are the staff
// rows of the block on its day, substitutes included and absent people not;
// the person who cancelled is left out.
func (s *InstanceLifecycleService) noticeStaffOfCancellation(ctx context.Context, instance *scheduleModel.ActivityInstance, actorAccountID *int64) error {
	if s.deps.StaffNotices == nil || instance == nil {
		return nil
	}
	ahead := calendar.DateFromTime(s.now()).DaysUntil(instance.Date)
	if ahead < 0 {
		return nil
	}
	rows, err := staffOfInstance(ctx, s.deps.InstanceStaffRepo, instance.ID)
	if err != nil {
		return &ports.ScheduleError{Op: "cancel instance: staff notice", Err: err}
	}
	staffIDs := distinctPresentStaffIDs(rows)
	if len(staffIDs) == 0 {
		return nil
	}
	staff, err := s.deps.StaffRepo.FindWithPersonByIDs(ctx, staffIDs)
	if err != nil {
		return &ports.ScheduleError{Op: "cancel instance: staff notice accounts", Err: err}
	}
	accountIDs := make([]int64, 0, len(staffIDs))
	for _, staffID := range staffIDs {
		member := staff[staffID]
		if member == nil || member.Person == nil || member.Person.AccountID == nil {
			continue
		}
		accountID := *member.Person.AccountID
		if actorAccountID != nil && accountID == *actorAccountID {
			continue
		}
		accountIDs = append(accountIDs, accountID)
	}
	if len(accountIDs) == 0 {
		return nil
	}
	if err := s.deps.StaffNotices.NotifyInstanceCancelled(ctx, ports.StaffCancellationNotice{
		InstanceID: instance.ID, Title: instance.Title, Date: instance.Date, StartTime: instance.StartTime,
		AccountIDs: accountIDs, Push: ahead <= staffNoticePushDays,
	}); err != nil {
		return &ports.ScheduleError{Op: "cancel instance: staff notice", Err: err}
	}
	return nil
}
