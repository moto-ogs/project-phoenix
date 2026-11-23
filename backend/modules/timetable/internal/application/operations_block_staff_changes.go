package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// BlockStaffChanges reads the blocks of a day on which a supervisor is
// marked absent or somebody covers, with all their staff rows, in one
// statement (#7675). Cancelled blocks are left out: the cancellation is the
// change. The absence reason stays in the owner.
func (s *operations) BlockStaffChanges(ctx context.Context, date calendar.Date) ([]timetable.BlockStaffChange, error) {
	rows, err := s.staffChangesOn(ctx, date.String())
	if err != nil {
		return nil, err
	}
	changes := make([]timetable.BlockStaffChange, 0)
	index := map[int64]int{}
	for _, row := range rows {
		if row.Block == nil {
			continue
		}
		at, seen := index[row.InstanceID]
		if !seen {
			at = len(changes)
			index[row.InstanceID] = at
			changes = append(changes, timetable.BlockStaffChange{
				InstanceID: row.InstanceID, Title: row.Block.Title,
				StartTime: row.Block.StartTime, EndTime: row.Block.EndTime,
			})
		}
		changes[at].Staff = append(changes[at].Staff, timetable.BlockStaffRow{
			StaffID: row.StaffID, Absent: row.IsAbsent, Substitute: row.IsSubstitute,
			SickReport: row.SickAbsenceID != nil,
		})
	}
	return changes, nil
}

// staffChangesOn reads the staff rows of the day's changed blocks; with a
// day staff share it takes every row of the day once and filters them.
func (s *operations) staffChangesOn(ctx context.Context, day string) ([]timetable.InstanceStaff, error) {
	if share, ok := timetable.DayStaffShareOf(ctx); ok {
		rows, err := s.dayStaff(ctx, share, day)
		if err != nil {
			return nil, err
		}
		return staffChangeRows(rows), nil
	}
	rows, err := s.deps.InstanceStaff.ListInstanceStaff(ctx, timetable.InstanceStaffFilter{
		Date: &day, StaffChangesOnly: true, OrderByActivityTime: true,
	})
	if err != nil {
		return nil, &ports.ScheduleError{Op: "block staff changes", Err: err}
	}
	return rows, nil
}
