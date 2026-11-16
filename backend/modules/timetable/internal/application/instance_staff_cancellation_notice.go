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
	notice, err := s.staffNotice(ctx, instance, actorAccountID, "cancel instance: staff notice")
	if err != nil || len(notice.AccountIDs) == 0 {
		return err
	}
	notice.Push = ahead <= staffNoticePushDays
	if err := s.deps.StaffNotices.NotifyInstanceCancelled(ctx, notice); err != nil {
		return &ports.ScheduleError{Op: "cancel instance: staff notice", Err: err}
	}
	return nil
}

// noticeStaffOfReinstatement tells the staff planned for the block that it
// takes place after all (#7151), in the reinstatement's transaction. It
// follows the cancellation's relevance window: a push while the block lies
// within 14 days, the feed only beyond. A cancellation that pushed lay
// within the window, and the block has come no further away since, so its
// reinstatement pushes too. Who switched the cancellation notice off gets no
// push of its reinstatement either; Delivery's root binding applies that
// switch. A block that has ended is never reinstated.
func (s *InstanceLifecycleService) noticeStaffOfReinstatement(ctx context.Context, instance *scheduleModel.ActivityInstance, actorAccountID *int64) error {
	if s.deps.StaffNotices == nil || instance == nil {
		return nil
	}
	notice, err := s.staffNotice(ctx, instance, actorAccountID, "reinstate instance: staff notice")
	if err != nil || len(notice.AccountIDs) == 0 {
		return err
	}
	notice.Push = calendar.DateFromTime(s.now()).DaysUntil(instance.Date) <= staffNoticePushDays
	if err := s.deps.StaffNotices.NotifyInstanceReinstated(ctx, notice); err != nil {
		return &ports.ScheduleError{Op: "reinstate instance: staff notice", Err: err}
	}
	return nil
}

// staffNotice addresses a notice about the block to its planned staff:
// the staff rows of the block on its day, substitutes included and absent
// people not, without the person who triggered the change.
func (s *InstanceLifecycleService) staffNotice(ctx context.Context, instance *scheduleModel.ActivityInstance, actorAccountID *int64, op string) (ports.StaffCancellationNotice, error) {
	notice := ports.StaffCancellationNotice{
		InstanceID: instance.ID, Title: instance.Title, Date: instance.Date, StartTime: instance.StartTime,
	}
	rows, err := staffOfInstance(ctx, s.deps.InstanceStaffRepo, instance.ID)
	if err != nil {
		return notice, &ports.ScheduleError{Op: op, Err: err}
	}
	staffIDs := distinctPresentStaffIDs(rows)
	if len(staffIDs) == 0 {
		return notice, nil
	}
	staff, err := s.deps.StaffRepo.FindWithPersonByIDs(ctx, staffIDs)
	if err != nil {
		return notice, &ports.ScheduleError{Op: op + " accounts", Err: err}
	}
	for _, staffID := range staffIDs {
		member := staff[staffID]
		if member == nil || member.Person == nil || member.Person.AccountID == nil {
			continue
		}
		accountID := *member.Person.AccountID
		if actorAccountID != nil && accountID == *actorAccountID {
			continue
		}
		notice.AccountIDs = append(notice.AccountIDs, accountID)
	}
	return notice, nil
}
