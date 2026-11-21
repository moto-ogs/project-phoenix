package daychangesview

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

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

// TestTodayOrdersEachSection composes fake sources (#7660): no source of
// the staff ticket has a time of day yet, so the order of the four kinds of
// rows is fixed here. Inside a section: new full-day changes, timed changes
// by start, long changes since an earlier day, summaries.
func TestTodayOrdersEachSection(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2026, 9, 9)
	at := func(hour int) *time.Time {
		instant := day.BerlinMidnight().Add(time.Duration(hour) * time.Hour)
		return &instant
	}
	since := day.AddDays(-5)
	count := 2
	named := func(name string, extra SourceEntry) SourceEntry {
		extra.Kind = KindStaffAbsent
		extra.People = []Person{{StaffID: 1, Name: name, Role: RoleAbsent}}
		return extra
	}
	v := &view{
		today: func() calendar.Date { return day }, isolation: fakeIsolation{},
		logger: slog.New(slog.DiscardHandler),
		sources: []sourceRead{{source: SourceStaff, read: entriesOf(
			SourceEntry{Kind: KindStaffAbsentCount, Count: &count},
			named("Long", SourceEntry{Since: &since}),
			named("Late", SourceEntry{StartsAt: at(15), EndsAt: at(16)}),
			named("Early", SourceEntry{StartsAt: at(8), EndsAt: at(9)}),
			named("New", SourceEntry{}),
			named("Mine", SourceEntry{Involved: true, StartsAt: at(7)}),
		)}},
	}

	overview, err := v.Today(context.Background())
	require.NoError(t, err)
	got := make([]string, 0, len(overview.Entries))
	for _, entry := range overview.Entries {
		got = append(got, string(entry.Section)+":"+firstName(entry))
	}
	assert.Equal(t, []string{"you:Mine", "school:New", "school:Early", "school:Late", "school:Long", "school:"}, got)
	assert.False(t, overview.Entries[0].AllDay, "a change with a start has a time of day")
	assert.Equal(t, at(8), overview.Entries[2].StartsAt)
	assert.Equal(t, at(9), overview.Entries[2].EndsAt)
	assert.True(t, overview.Entries[1].AllDay)
}

// TestNewRequiresEveryPort keeps missing wiring a configuration error.
func TestNewRequiresEveryPort(t *testing.T) {
	t.Parallel()
	_, err := New(Dependencies{})
	require.ErrorIs(t, err, ErrDependencies)
}
