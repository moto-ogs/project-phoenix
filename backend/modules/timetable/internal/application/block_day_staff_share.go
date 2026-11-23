package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	scheduleModels "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
)

// The block reads of one "Heute anders" request, BlockStaffChanges for the
// Personal source and BlockDayChanges for the Stundenplan source, share the
// day's staff rows (#7666, the query budget of the route): the first read
// takes every staff row of the day with its block in one statement, the
// second filters them. Without the share each read keeps its own statement.

// dayStaff reads every staff row of the day with its block, once per share.
func (s *operations) dayStaff(ctx context.Context, share *timetable.DayStaffShare, day string) ([]timetable.InstanceStaff, error) {
	if share.Read && share.Day == day {
		return share.Rows, nil
	}
	rows, err := s.deps.InstanceStaff.ListInstanceStaff(ctx, timetable.InstanceStaffFilter{
		Date: &day, WithBlock: true, OrderByActivityTime: true,
	})
	if err != nil {
		return nil, &ports.ScheduleError{Op: "block staff of the day", Err: err}
	}
	share.Day, share.Rows, share.Read = day, rows, true
	return rows, nil
}

// sharedStaffOf returns the shared rows of the day, or false when no block
// read of this request has taken them yet.
func sharedStaffOf(ctx context.Context, day string) ([]timetable.InstanceStaff, bool) {
	share, ok := timetable.DayStaffShareOf(ctx)
	if !ok || !share.Read || share.Day != day {
		return nil, false
	}
	return share.Rows, true
}

// staffChangeRows keeps the rows StaffChangesOnly keeps: every row of a
// block that takes place and carries an absent or covering supervisor.
func staffChangeRows(rows []timetable.InstanceStaff) []timetable.InstanceStaff {
	changed := map[int64]bool{}
	for _, row := range rows {
		if row.IsAbsent || row.IsSubstitute {
			changed[row.InstanceID] = true
		}
	}
	kept := make([]timetable.InstanceStaff, 0, len(rows))
	for _, row := range rows {
		if changed[row.InstanceID] && row.Block != nil && !row.Block.Cancelled {
			kept = append(kept, row)
		}
	}
	return kept
}

// staffOfShared keeps the shared rows of the instances, in the order
// staffOfInstances reads them: by instance, then as they were added.
func staffOfShared(rows []timetable.InstanceStaff, instanceIDs []int64) []*scheduleModels.InstanceStaff {
	wanted := make(map[int64]bool, len(instanceIDs))
	for _, id := range instanceIDs {
		wanted[id] = true
	}
	kept := make([]timetable.InstanceStaff, 0, len(rows))
	for _, row := range rows {
		if wanted[row.InstanceID] {
			kept = append(kept, row)
		}
	}
	slices.SortStableFunc(kept, func(a, b timetable.InstanceStaff) int {
		switch {
		case a.InstanceID != b.InstanceID:
			return compareInt64(a.InstanceID, b.InstanceID)
		case !a.CreatedAt.Equal(b.CreatedAt):
			return a.CreatedAt.Compare(b.CreatedAt)
		default:
			return compareInt64(a.ID, b.ID)
		}
	})
	result := make([]*scheduleModels.InstanceStaff, 0, len(kept))
	for _, row := range kept {
		result = append(result, legacyInstanceStaff(row))
	}
	return result
}

func compareInt64(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}
