package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeAssignees(t *testing.T) {
	t.Parallel()
	ids, err := NormalizeAssignees([]int64{9, 3, 9, 5}, 10)
	require.NoError(t, err)
	assert.Equal(t, []int64{3, 5, 9}, ids, "ascending and unique: the order the per-staff locks are taken in")

	for name, input := range map[string][]int64{"empty": nil, "zero": {4, 0}, "negative": {-1}} {
		_, err := NormalizeAssignees(input, 10)
		assert.ErrorIs(t, err, ErrInvalidWorkTime, name)
	}
	_, err = NormalizeAssignees([]int64{1, 2, 3}, 2)
	assert.ErrorIs(t, err, ErrInvalidWorkTime, "more people than one request may carry")
	ids, err = NormalizeAssignees([]int64{1, 1, 2}, 2)
	require.NoError(t, err, "duplicates count once against the limit")
	assert.Equal(t, []int64{1, 2}, ids)
}

func TestAssignmentVersionStart(t *testing.T) {
	t.Parallel()
	const today = "2026-09-09"
	closedJuly := &StaffMonthBalanceSnapshot{StaffID: 7, Year: 2026, Month: 7}
	reopenedAugust := &StaffMonthBalanceSnapshot{StaffID: 7, Year: 2026, Month: 8, ReopenedAt: &closedJuly.ClosedAt}

	t.Run("today or empty starts today for everybody", func(t *testing.T) {
		t.Parallel()
		history := map[int64]bool{7: true}
		for _, validFrom := range []string{"", today} {
			start, err := AssignmentVersionStart(validFrom, today, []int64{7, 8}, history, []*StaffMonthBalanceSnapshot{closedJuly})
			require.NoError(t, err)
			assert.Equal(t, today, start)
		}
	})

	t.Run("an earlier day for people without a schedule, after the closed month", func(t *testing.T) {
		t.Parallel()
		start, err := AssignmentVersionStart("2026-08-01", today, []int64{7, 8}, map[int64]bool{}, []*StaffMonthBalanceSnapshot{closedJuly, reopenedAugust})
		require.NoError(t, err)
		assert.Equal(t, "2026-08-01", start, "a reopened month does not block")
	})

	t.Run("one person with a schedule refuses the earlier day for all", func(t *testing.T) {
		t.Parallel()
		_, err := AssignmentVersionStart("2026-09-01", today, []int64{7, 8}, map[int64]bool{8: true}, nil)
		require.ErrorIs(t, err, ErrInvalidWorkTime)
		assert.Contains(t, err.Error(), "staff member 8")
	})

	t.Run("a closed month of one person refuses the day", func(t *testing.T) {
		t.Parallel()
		_, err := AssignmentVersionStart("2026-07-15", today, []int64{7, 8}, map[int64]bool{}, []*StaffMonthBalanceSnapshot{closedJuly})
		require.ErrorIs(t, err, ErrInvalidWorkTime)
		assert.Contains(t, err.Error(), "staff member 7")
		assert.Contains(t, err.Error(), "2026-07")
	})

	t.Run("a closed month of somebody else does not block", func(t *testing.T) {
		t.Parallel()
		start, err := AssignmentVersionStart("2026-07-15", today, []int64{8}, map[int64]bool{}, []*StaffMonthBalanceSnapshot{closedJuly})
		require.NoError(t, err)
		assert.Equal(t, "2026-07-15", start)
	})

	t.Run("a future day and a malformed day are refused", func(t *testing.T) {
		t.Parallel()
		for _, validFrom := range []string{"2026-09-10", "2026-9-1"} {
			_, err := AssignmentVersionStart(validFrom, today, []int64{8}, map[int64]bool{}, nil)
			assert.ErrorIs(t, err, ErrInvalidWorkTime, validFrom)
		}
	})
}
