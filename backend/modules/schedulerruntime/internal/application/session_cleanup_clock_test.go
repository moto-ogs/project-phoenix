package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sessionCleanupSettings enables the abandoned-session cleanup with the
// default interval and threshold.
type sessionCleanupSettings struct{}

func (sessionCleanupSettings) ResolveString(context.Context, string) (string, error) { return "", nil }
func (sessionCleanupSettings) ResolveBool(context.Context, string) (bool, error)     { return true, nil }
func (sessionCleanupSettings) ResolveInt(context.Context, string) (int, error)       { return 0, nil }

// The interval since a tenant's last cleanup counts on the scheduler's clock,
// which also stamped that run: a clock far from the real day neither runs the
// cleanup on every poll nor suppresses it for good.
func TestSessionCleanupIntervalCountsOnTheSchedulerClock(t *testing.T) {
	t.Parallel()
	for name, start := range map[string]time.Time{
		"past day":   time.Date(2021, time.March, 10, 10, 0, 0, 0, time.UTC),
		"future day": time.Date(2031, time.March, 12, 10, 0, 0, 0, time.UTC),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			now := start
			active := &mockActiveService{}
			s := unitScheduler(&unitSchedulerDependencies{
				activeService: active, settings: sessionCleanupSettings{},
				now: func() time.Time { return now }, done: make(chan struct{}),
			})

			require.NoError(t, s.runSessionCleanupForTenant(context.Background(), 7))
			now = start.Add(5 * time.Minute)
			require.NoError(t, s.runSessionCleanupForTenant(context.Background(), 7))
			assert.Equal(t, 1, active.cleanupAbandonedCalls, "a poll inside the interval skips the cleanup")

			now = start.Add(15 * time.Minute)
			require.NoError(t, s.runSessionCleanupForTenant(context.Background(), 7))
			assert.Equal(t, 2, active.cleanupAbandonedCalls, "a poll after the interval runs the cleanup")
		})
	}
}
