package daychangesview

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// fakeIsolation runs the read in place and counts its runs; fatal marks
// its own failure.
type fakeIsolation struct {
	fatal error
	runs  *int
}

func (f fakeIsolation) Run(ctx context.Context, read func(context.Context) error) error {
	if f.runs != nil {
		*f.runs++
	}
	if f.fatal != nil {
		return f.fatal
	}
	return read(ctx)
}

func (f fakeIsolation) IsFatal(err error) bool { return f.fatal != nil && errors.Is(err, f.fatal) }

func entriesOf(entries ...SourceEntry) func(context.Context, calendar.Date) ([]SourceEntry, error) {
	return func(context.Context, calendar.Date) ([]SourceEntry, error) { return entries, nil }
}

// TestTodayKeepsOtherSourcesWhenOneFails is Seam 2: a failing source is
// marked failed and logged without personal data, the others still answer,
// and only a failure of the isolation itself fails the request.
func TestTodayKeepsOtherSourcesWhenOneFails(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2026, 9, 9)
	var logs bytes.Buffer
	failing := func(context.Context, calendar.Date) ([]SourceEntry, error) {
		return nil, errors.New("relation does not exist")
	}
	build := func(isolation Isolation) *view {
		return &view{
			today: func() calendar.Date { return day }, isolation: isolation,
			logger: slog.New(slog.NewTextHandler(&logs, nil)),
			sources: []sourceRead{
				{source: SourceNotices, read: entriesOf(SourceEntry{
					Kind: KindStaffNotice, Notice: &DayNotice{ID: 3, Title: "Elternabend"},
				})},
				{source: "first", read: failing},
				{source: SourceStaff, read: entriesOf(SourceEntry{
					Kind: KindStaffAbsent, Involved: true,
					People: []Person{{StaffID: 7, Name: "Ben Kollege", Role: RoleAbsent}},
				})},
			},
		}
	}

	runs := 0
	overview, err := build(fakeIsolation{runs: &runs}).Today(context.Background())
	require.NoError(t, err)
	assert.Equal(t, day, overview.Date)
	assert.Equal(t, []SourceStatus{
		{Source: SourceNotices, Status: SourceLoaded},
		{Source: "first", Status: SourceFailed},
		{Source: SourceStaff, Status: SourceLoaded},
	}, overview.Sources)
	require.Len(t, overview.Entries, 2, "the entries read before the failure are kept")
	assert.Equal(t, SectionYou, overview.Entries[0].Section)
	assert.Equal(t, KindStaffNotice, overview.Entries[1].Kind)
	assert.Equal(t, 2, runs, "the sources share one isolation until one fails; the rest get a fresh one")

	runs = 0
	_, err = (&view{
		today: func() calendar.Date { return day }, isolation: fakeIsolation{runs: &runs}, logger: slog.Default(),
		sources: []sourceRead{{source: SourceStaff, read: entriesOf()}, {source: SourceNotices, read: entriesOf()}},
	}).Today(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, runs, "succeeding sources share one isolation")
	assert.Contains(t, logs.String(), "source=first")
	assert.NotContains(t, logs.String(), "Ben", "the log names no person")

	fatal := errors.New("savepoint control failed")
	_, err = build(fakeIsolation{fatal: fatal}).Today(context.Background())
	require.ErrorIs(t, err, fatal)
}

// TestNewRequiresEveryPort keeps missing wiring a configuration error.
func TestNewRequiresEveryPort(t *testing.T) {
	t.Parallel()
	_, err := New(Dependencies{})
	require.ErrorIs(t, err, ErrDependencies)
}
