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

// fakeIsolation runs the read in place; fatal marks its own failure.
type fakeIsolation struct{ fatal error }

func (f fakeIsolation) Run(ctx context.Context, read func(context.Context) error) error {
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
				{source: "first", read: failing},
				{source: SourceStaff, read: entriesOf(SourceEntry{
					Kind: KindStaffAbsent, Involved: true,
					People: []Person{{StaffID: 7, Name: "Ben Kollege", Role: RoleAbsent}},
				})},
			},
		}
	}

	overview, err := build(fakeIsolation{}).Today(context.Background())
	require.NoError(t, err)
	assert.Equal(t, day, overview.Date)
	assert.Equal(t, []SourceStatus{{Source: "first", Status: SourceFailed}, {Source: SourceStaff, Status: SourceLoaded}}, overview.Sources)
	require.Len(t, overview.Entries, 1)
	assert.Equal(t, SectionYou, overview.Entries[0].Section)
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

// gateDenied is a source port whose Gate closes it to the caller.
type gateDenied struct{}

func (gateDenied) Readable(context.Context) bool { return false }

// TestClosedGateSkipsTheSource proves a source the caller may not read is
// loaded without entries and opens no savepoint.
func TestClosedGateSkipsTheSource(t *testing.T) {
	t.Parallel()
	isolation := &countingIsolation{}
	v := &view{
		today: func() calendar.Date { return calendar.NewDate(2026, 9, 9) }, isolation: isolation, logger: slog.Default(),
		sources: []sourceRead{gated(sourceRead{source: SourceActivities, read: entriesOf(SourceEntry{Kind: KindActivityCancelled})}, gateDenied{})},
	}
	overview, err := v.Today(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []SourceStatus{{Source: SourceActivities, Status: SourceLoaded}}, overview.Sources)
	assert.Empty(t, overview.Entries)
	assert.Zero(t, isolation.runs)
}

type countingIsolation struct{ runs int }

func (c *countingIsolation) Run(ctx context.Context, read func(context.Context) error) error {
	c.runs++
	return read(ctx)
}

func (*countingIsolation) IsFatal(error) bool { return false }
