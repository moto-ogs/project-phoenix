package timetracking

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// traegerCloseRepo records the order of the close: the lock, the snapshot
// read and the write.
type traegerCloseRepo struct {
	MonthSnapshots
	events *[]string
}

func (r *traegerCloseRepo) LockStaffBalanceWrites(context.Context, int64) error {
	*r.events = append(*r.events, "lock")
	return nil
}

func (r *traegerCloseRepo) ClosedMonthSnapshotsForStaff(context.Context, []int64) ([]*MonthSnapshot, error) {
	return nil, nil
}

func (r *traegerCloseRepo) RecordClosedMonth(_ context.Context, value MonthSnapshot) (MonthSnapshot, error) {
	*r.events = append(*r.events, "create")
	return value, nil
}

// keptEveryMonth says a contract of the Träger covers every month.
type keptEveryMonth struct{}

func (keptEveryMonth) TraegerKeptStaffByMonth(_ context.Context, staffIDs []int64, first, _ calendar.Date) (map[calendar.Date][]int64, error) {
	return map[calendar.Date][]int64{first: staffIDs}, nil
}

// The Träger closes the balances its Personalverwaltung confirmed (ADR
// 0311): the school compares the read under its balance lock, before it
// freezes anything, and a refusal writes no snapshot.
func TestCloseMonthForTraegerChecksTheReadUnderTheBalanceLock(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		check  error
		events []string
	}{
		{"a changed month is refused", readstate.ErrChanged, []string{"lock", "check"}},
		{"the month as read is closed", nil, []string{"lock", "check", "create"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			events := []string{}
			service := NewStaffMonthCloseService(
				&traegerCloseRepo{events: &events},
				&recordingMonthCloseMonthService{events: new([]string)},
				&recordingMonthCloseStaffLister{events: new([]string)},
				&wtmMockSettings{accountStart: "2025-01-01"},
				slog.New(slog.DiscardHandler),
				WithMonthCloseTraeger(keptEveryMonth{}),
				func(s *staffMonthCloseService) { s.now = testNow },
			)
			_, err := service.CloseMonthForTraeger(context.Background(), 41, 9, 2025, 8, "Lohnabrechnung", func(context.Context) error {
				events = append(events, "check")
				return tc.check
			})
			if tc.check != nil {
				require.ErrorIs(t, err, readstate.ErrChanged)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tc.events, events)
		})
	}
}

// traegerCloseMonths is the school's month as the Träger reads and closes
// it; ActualMinutes moves when a colleague books time.
type traegerCloseMonths struct {
	workforce.WorkTimeMonths
	actual int
	closed bool
}

func (m *traegerCloseMonths) MonthSummary(context.Context, int64, int, int) (*workforce.MonthSummary, error) {
	return &workforce.MonthSummary{Year: 2025, Month: 8, ActualMinutes: m.actual}, nil
}

func (m *traegerCloseMonths) TraegerMonthState(context.Context, int64, int, int) (*TraegerMonthState, error) {
	return &TraegerMonthState{Kept: true, Ended: true}, nil
}

func (m *traegerCloseMonths) CloseMonthForTraeger(ctx context.Context, _, _ int64, _, _ int, _ string, unchanged func(context.Context) error) (bool, error) {
	if err := unchanged(ctx); err != nil {
		return false, err
	}
	m.closed = true
	return true, nil
}

func (m *traegerCloseMonths) ReopenMonthForTraeger(context.Context, int64, int64, int, int, string) error {
	return nil
}

// The school compares the Version of the Träger's read with the same read
// under the lock: a month booked since is refused, the month as read closes.
func TestTraegerMonthCapabilityClosesOnlyTheMonthAsRead(t *testing.T) {
	t.Parallel()
	months := &traegerCloseMonths{actual: 600}
	capability := TraegerMonthCapability(months, months)
	read, err := capability.TraegerMonthAccount(context.Background(), 41, 2025, 8)
	require.NoError(t, err)
	require.NotEmpty(t, read.Version)

	months.actual = 660
	_, err = capability.CloseMonthForTraeger(context.Background(), 41, 9, 2025, 8, "Lohnabrechnung", read.Version)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.False(t, months.closed, "balances the Personalverwaltung has not seen stay open")

	current, err := capability.TraegerMonthAccount(context.Background(), 41, 2025, 8)
	require.NoError(t, err)
	_, err = capability.CloseMonthForTraeger(context.Background(), 41, 9, 2025, 8, "Lohnabrechnung", current.Version)
	require.NoError(t, err)
	assert.True(t, months.closed)
}
