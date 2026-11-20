// Package presence_test holds the live-group openness test and the route
// helpers the web attendance tests share.
package presence_test

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Live Group Openness Tests
// =============================================================================

func TestLiveGroup_IsOpen(t *testing.T) {
	t.Parallel()

	t.Run("group with no end time is open", func(t *testing.T) {
		group := studentpresence.LiveGroup{
			RoomID: 1,
		}
		assert.True(t, group.IsOpen())
	})

	t.Run("group with end time is not open (regardless of time)", func(t *testing.T) {
		// IsOpen() returns true only when EndTime is nil
		futureTime := time.Now().Add(1 * time.Hour)
		group := studentpresence.LiveGroup{
			RoomID:  1,
			EndTime: &futureTime,
		}
		assert.False(t, group.IsOpen()) // EndTime is set, so not open
	})

	t.Run("group with past end time is not open", func(t *testing.T) {
		pastTime := time.Now().Add(-1 * time.Hour)
		group := studentpresence.LiveGroup{
			RoomID:  1,
			EndTime: &pastTime,
		}
		assert.False(t, group.IsOpen())
	})
}

func testPresenceQueries(t *testing.T, db *testpkg.DB) studentpresence.Owner {
	t.Helper()
	module, err := presenceCompose.New(presenceCompose.Dependencies{DB: db, Observe: func(presenceCompose.Observation) {}})
	require.NoError(t, err)
	return module
}
