package owners

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/communication/ports"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Each adapter binds one owner's reads to Communication's letter vocabulary.
// Joining the sources and deriving the letter values belongs to Communication.
type parentLetterStudents struct{ source ParentLetterStudents }

func (s parentLetterStudents) ListStudentsByID(ctx context.Context, ids []int64) ([]ports.ParentLetterStudent, error) {
	students, err := s.source.ListStudentsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]ports.ParentLetterStudent, 0, len(students))
	for _, student := range students {
		out = append(out, ports.ParentLetterStudent{ID: student.ID, SchoolClass: student.SchoolClass, GroupID: student.GroupID})
	}
	return out, nil
}

func (s parentLetterStudents) ListStudentNamesByID(ctx context.Context, ids []int64) ([]ports.ParentLetterStudentName, error) {
	names, err := s.source.ListStudentNamesByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]ports.ParentLetterStudentName, 0, len(names))
	for _, name := range names {
		out = append(out, ports.ParentLetterStudentName{StudentID: name.StudentID, FirstName: name.FirstName, LastName: name.LastName})
	}
	return out, nil
}

type parentLetterGroups struct{ source schoolstructure.Query }

func (s parentLetterGroups) GroupNames(ctx context.Context, ids []int64) (map[int64]string, error) {
	groups, err := s.source.ListGroupsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	names := make(map[int64]string, len(groups))
	for _, group := range groups {
		names[group.ID] = group.Name
	}
	return names, nil
}

type parentLetterPickups struct{ source ParentLetterPickups }

func (s parentLetterPickups) GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, ids []int64, date calendar.Date) ([]*ports.ParentLetterPickup, error) {
	schedules, err := s.source.GetWeeklySchedulesByStudentIDsForDate(ctx, ids, date)
	if err != nil {
		return nil, err
	}
	out := make([]*ports.ParentLetterPickup, len(schedules))
	for i, schedule := range schedules {
		if schedule != nil {
			out[i] = &ports.ParentLetterPickup{StudentID: schedule.StudentID, Weekday: schedule.Weekday, PickupTime: schedule.PickupTime}
		}
	}
	return out, nil
}

type parentLetterArrivals struct{ source ParentLetterArrivals }

func (s parentLetterArrivals) GetWeeklySchedulesByStudentIDsForDate(ctx context.Context, ids []int64, date calendar.Date) ([]*ports.ParentLetterArrival, error) {
	schedules, err := s.source.GetWeeklySchedulesByStudentIDsForDate(ctx, ids, date)
	if err != nil {
		return nil, err
	}
	out := make([]*ports.ParentLetterArrival, len(schedules))
	for i, schedule := range schedules {
		if schedule != nil {
			out[i] = &ports.ParentLetterArrival{StudentID: schedule.StudentID, Weekday: schedule.Weekday}
		}
	}
	return out, nil
}
