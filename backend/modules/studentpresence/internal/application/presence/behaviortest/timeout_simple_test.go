// Package active_test tests UpdateSessionActivity, which stamps the
// LastActivity timestamp of an active session, with hermetic testing pattern.
//
// Each test creates its own fixtures, performs operations, and cleans up after itself.
// No mocks are used - all tests run against a real test database.
package behaviortest_test

import (
	"errors"
	"testing"
	"time"

	activeService "github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/application/presence"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestUpdateSessionActivity tests updating session activity timestamp
func TestUpdateSessionActivity(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupActiveService(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("successful activity update", func(t *testing.T) {
		// ARRANGE: Create test fixtures
		activity := testpkg.CreateTestActivityGroup(t, db, "Update Activity Test")
		device := testpkg.CreateTestDevice(t, db, "update-device-001")
		room := testpkg.CreateTestRoom(t, db, "Update Test Room")
		staff := testpkg.CreateTestStaff(t, db, "Update", "Tester")

		// Start a session to test activity update
		session, err := service.StartActivitySessionWithSupervisors(ctx, activity.ID, device.ID, []int64{staff.ID}, &room.ID)
		require.NoError(t, err)
		require.NotNil(t, session)

		// Backdate LastActivity so only a real write can move it forward
		backdated := time.Now().Add(-10 * time.Minute)
		_, err = db.NewUpdate().
			Table("active.groups").
			Set("last_activity = ?", backdated).
			Where("id = ?", session.ID).
			Exec(ctx)
		require.NoError(t, err)

		// ACT: Update session activity
		err = service.UpdateSessionActivity(ctx, session.ID)

		// ASSERT
		require.NoError(t, err)

		// Verify LastActivity was updated
		updatedSession, err := service.GetActiveGroup(ctx, session.ID)
		require.NoError(t, err)
		assert.True(t, updatedSession.LastActivity.After(backdated),
			"LastActivity should be updated to a later time")
	})

	t.Run("session not found", func(t *testing.T) {
		// ACT: Try to update a non-existent session
		err := service.UpdateSessionActivity(ctx, 99999)

		// ASSERT
		require.Error(t, err)
		assert.ErrorIs(t, err, activeService.ErrActiveGroupNotFound)
	})

	t.Run("session already ended", func(t *testing.T) {
		// ARRANGE: Create test fixtures
		activity := testpkg.CreateTestActivityGroup(t, db, "Ended Session Activity")
		device := testpkg.CreateTestDevice(t, db, "ended-device-001")
		room := testpkg.CreateTestRoom(t, db, "Ended Session Room")
		staff := testpkg.CreateTestStaff(t, db, "Ended", "Staff")

		// Start and immediately end a session
		session, err := service.StartActivitySessionWithSupervisors(ctx, activity.ID, device.ID, []int64{staff.ID}, &room.ID)
		require.NoError(t, err)

		_, err = service.EndActivitySession(ctx, session.ID)
		require.NoError(t, err)

		// ACT: Try to update the ended session
		err = service.UpdateSessionActivity(ctx, session.ID)

		// ASSERT
		require.Error(t, err)
		assert.ErrorIs(t, err, activeService.ErrActiveGroupAlreadyEnded)
	})

	t.Run("wrapped active errors still unwrap to sentinels", func(t *testing.T) {
		err := service.UpdateSessionActivity(ctx, 99999)

		require.Error(t, err)
		var activeErr *activeService.ActiveError
		assert.True(t, errors.As(err, &activeErr))
		assert.ErrorIs(t, activeErr, activeService.ErrActiveGroupNotFound)
	})
}
