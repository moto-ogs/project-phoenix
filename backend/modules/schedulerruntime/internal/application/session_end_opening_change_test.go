package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The session end of a day with changed opening hours is the closing time of
// the change (#8157); every other day keeps operations.session_end_time.
func TestSessionEndTimeTodayFollowsTheOpeningChange(t *testing.T) {
	t.Parallel()
	// 23:30 UTC on 2026-12-17 is already 2026-12-18 in Berlin.
	now := time.Date(2026, 12, 17, 23, 30, 0, 0, time.UTC)
	settings := registrySettings{overrides: map[string]any{settingSessionEndTime: "16:30"}}
	scheduler := func(closing func(context.Context, calendar.Date) (string, bool, error)) *Scheduler {
		s := unitScheduler(&unitSchedulerDependencies{done: make(chan struct{}), settings: settings, now: func() time.Time { return now }})
		s.closingTimes = closing
		return s
	}

	end, err := scheduler(nil).sessionEndTimeToday(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "16:30", end, "without the calendar the setting holds")

	var asked calendar.Date
	end, err = scheduler(func(_ context.Context, day calendar.Date) (string, bool, error) {
		asked = day
		return "12:00", true, nil
	}).sessionEndTimeToday(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "12:00", end, "the changed closing time replaces the session end")
	assert.Equal(t, calendar.NewDate(2026, time.December, 18), asked, "the school's day is the Berlin day")

	end, err = scheduler(func(context.Context, calendar.Date) (string, bool, error) { return "", false, nil }).sessionEndTimeToday(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "16:30", end, "a day without a change keeps the setting")

	failure := errors.New("calendar unavailable")
	_, err = scheduler(func(context.Context, calendar.Date) (string, bool, error) { return "", false, failure }).sessionEndTimeToday(context.Background())
	require.ErrorIs(t, err, failure, "a failed read is no silent fallback to the setting")
}
