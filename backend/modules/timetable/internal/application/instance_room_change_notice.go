package application

import (
	"context"

	scheduleModel "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// roomChangeSoonDays bounds the move a push announces unless the person
// switched it off (#7141): today and tomorrow. A later move within
// staffNoticePushDays pushes only for whoever switched that on.
const roomChangeSoonDays = 1

// noticeRoomChange tells the staff of an edited block and the families of
// its children that it takes place in another room (#7141), in the edit's
// transaction. Only a change from one room to another counts: a block that
// gets its first room or loses its room did not move. Recipients are the
// block's staff and children after the edit; the person who made the change
// is left out. Nothing is written for a block in the past.
func (s *InstanceLifecycleService) noticeRoomChange(ctx context.Context, instance *scheduleModel.ActivityInstance, previousRoomID int64, actorAccountID *int64) error {
	if s.deps.RoomNotices == nil || instance == nil || previousRoomID <= 0 || instance.RoomID <= 0 || previousRoomID == instance.RoomID {
		return nil
	}
	ahead := calendar.DateFromTime(s.now()).DaysUntil(instance.Date)
	if ahead < 0 {
		return nil
	}
	const op = "update instance: room notice"
	staff, err := s.staffNotice(ctx, instance, actorAccountID, op)
	if err != nil {
		return err
	}
	studentIDs, err := s.noticeStudentIDs(ctx, instance.ID)
	if err != nil {
		return err
	}
	if len(staff.AccountIDs) == 0 && len(studentIDs) == 0 {
		return nil
	}
	names, err := s.deps.Rooms.RoomNamesByID(ctx, []int64{previousRoomID, instance.RoomID})
	if err != nil {
		return &ports.ScheduleError{Op: op + " rooms", Err: err}
	}
	notice := ports.InstanceRoomChangeNotice{
		InstanceID: instance.ID, Title: instance.Title, Date: instance.Date, StartTime: instance.StartTime,
		RoomName: names[instance.RoomID], PreviousRoom: names[previousRoomID],
		StaffAccountIDs: staff.AccountIDs, StudentIDs: studentIDs,
		Soon: ahead <= roomChangeSoonDays, Push: roomChangePush(ahead),
	}
	if actorAccountID != nil {
		notice.ActorAccountID = *actorAccountID
	}
	if err := s.deps.RoomNotices.NotifyInstanceRoomChanged(ctx, notice); err != nil {
		return &ports.ScheduleError{Op: op, Err: err}
	}
	return nil
}

// roomChangePush is how far a move days ahead may ring a phone.
func roomChangePush(ahead int) ports.RoomChangePush {
	switch {
	case ahead <= roomChangeSoonDays:
		return ports.RoomChangePushSoon
	case ahead <= staffNoticePushDays:
		return ports.RoomChangePushLater
	default:
		return ports.RoomChangePushNone
	}
}
