package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ timetable.PlannedRoomQuery = (*operations)(nil)

// PlannedRoomIDs names the rooms of the day's blocks the staff member is
// planned on, covers or supervises and that take place (#8234): a block in a
// closed room concerns the caller under "Betrifft dich". Inside a "Heute
// anders" request the day's shared staff rows answer it without a statement
// of their own; otherwise one statement reads the member's rows of the day.
func (s *operations) PlannedRoomIDs(ctx context.Context, staffID int64, date calendar.Date) ([]int64, error) {
	if staffID <= 0 || date.IsZero() {
		return nil, nil
	}
	day := date.String()
	var rows []timetable.InstanceStaff
	var err error
	if share, ok := timetable.DayStaffShareOf(ctx); ok {
		rows, err = s.dayStaff(ctx, share, day)
	} else {
		rows, err = s.deps.InstanceStaff.ListInstanceStaff(ctx, timetable.InstanceStaffFilter{
			Date: &day, StaffIDs: []int64{staffID}, WithBlock: true,
		})
		if err != nil {
			err = &ports.ScheduleError{Op: "planned rooms of the day", Err: err}
		}
	}
	if err != nil {
		return nil, err
	}
	return plannedRooms(rows, staffID), nil
}

// plannedRooms keeps the rooms of the member's rows on blocks that take
// place and that the member does not miss, each room once, in ascending order.
func plannedRooms(rows []timetable.InstanceStaff, staffID int64) []int64 {
	rooms := []int64{}
	for _, row := range rows {
		if row.StaffID != staffID || row.IsAbsent || row.Block == nil || row.Block.Cancelled || row.Block.RoomID <= 0 {
			continue
		}
		rooms = append(rooms, row.Block.RoomID)
	}
	slices.Sort(rooms)
	return slices.Compact(rooms)
}
