package application

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The shared rows of the day (#7666) must give each block read what its own
// statement gives: the changed blocks' rows in clock order for the Personal
// source, every retained instance's rows by instance and creation for the
// Stundenplan source.
func TestDayStaffShareFiltersLikeTheOwnStatements(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 9, 9, 8, 0, 0, 0, time.UTC)
	block := func(cancelled bool) *timetable.InstanceStaffBlock {
		return &timetable.InstanceStaffBlock{Title: "AG", StartTime: "13:00", EndTime: "14:00", Cancelled: cancelled}
	}
	// In clock order, as the shared statement reads them.
	rows := []timetable.InstanceStaff{
		{ID: 5, InstanceID: 2, StaffID: 20, CreatedAt: at.Add(time.Minute), IsAbsent: true, Block: block(false)},
		{ID: 4, InstanceID: 2, StaffID: 21, CreatedAt: at, Block: block(false)},
		{ID: 6, InstanceID: 3, StaffID: 22, CreatedAt: at, Block: block(false)},
		{ID: 7, InstanceID: 4, StaffID: 23, CreatedAt: at, IsSubstitute: true, Block: block(true)},
		{ID: 8, InstanceID: 1, StaffID: 24, CreatedAt: at, IsSubstitute: true, Block: block(false)},
	}

	changed := staffChangeRows(rows)
	ids := make([]int64, 0, len(changed))
	for _, row := range changed {
		ids = append(ids, row.ID)
	}
	assert.Equal(t, []int64{5, 4, 8}, ids, "rows of blocks with a change that take place, every row of such a block, clock order kept")

	retained := staffOfShared(rows, []int64{1, 2, 3})
	ids = ids[:0]
	for _, row := range retained {
		ids = append(ids, row.ID)
	}
	assert.Equal(t, []int64{8, 4, 5, 6}, ids, "the retained instances' rows by instance, then as they were added")
}

func TestSharedStaffOfAnswersOnlyAfterTheReadOfThatDay(t *testing.T) {
	t.Parallel()
	_, ok := sharedStaffOf(context.Background(), "2026-09-09")
	assert.False(t, ok, "without a share each read keeps its own statement")

	ctx := timetable.WithDayStaffShare(context.Background())
	_, ok = sharedStaffOf(ctx, "2026-09-09")
	assert.False(t, ok, "nothing is shared before the first read")

	share, found := timetable.DayStaffShareOf(ctx)
	require.True(t, found)
	share.Day, share.Rows, share.Read = "2026-09-09", []timetable.InstanceStaff{{ID: 1}}, true
	rows, ok := sharedStaffOf(ctx, "2026-09-09")
	assert.True(t, ok)
	assert.Len(t, rows, 1)
	_, ok = sharedStaffOf(ctx, "2026-09-10")
	assert.False(t, ok, "another day reads again")
}
