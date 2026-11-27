package daychangesviewhttp_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestRoomClosureOfOwnBlockConcernsYou is the "Betrifft dich" seam of the
// room closure (#8234). A staff member with an own block in the closed room
// today finds the closure under "Betrifft dich"; whoever has no block there,
// misses the block (absent) or has it cancelled finds it under "Schule". The
// read of the own blocks costs no statement: the day's staff rows the block
// sources took answer it.
func TestRoomClosureOfOwnBlockConcernsYou(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	router := newRouter(t, db, day)

	werkraum := testpkg.CreateTestRoom(t, db, "Werkraum Eigene Sperre")
	closeTestRoom(t, db, tenantID, werkraum.ID, day, day, "Wasserschaden")
	planned, plannedAccount := testpkg.CreateTestStaffWithAccount(t, db, "Pia", "Plan")
	absent, absentAccount := testpkg.CreateTestStaffWithAccount(t, db, "Abe", "Abwesend")
	cancelled, cancelledAccount := testpkg.CreateTestStaffWithAccount(t, db, "Cora", "Abgesagt")
	_, bystanderAccount := testpkg.CreateTestStaffWithAccount(t, db, "Udo", "Ohne Termin")
	werken := testpkg.CreateTestActivityInstance(t, db, day, werkraum.ID, testpkg.ActivityInstanceOpts{Title: "Werken"})
	testpkg.CreateTestInstanceStaff(t, db, werken.ID, planned.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	testpkg.CreateTestInstanceStaff(t, db, werken.ID, absent.ID, testpkg.InstanceStaffOpts{IsAbsent: true})
	abgesagt := testpkg.CreateTestActivityInstance(t, db, day, werkraum.ID, testpkg.ActivityInstanceOpts{Title: "Basteln", Status: "cancelled", StartHHMM: "15:00", EndHHMM: "16:00"})
	testpkg.CreateTestInstanceStaff(t, db, abgesagt.ID, cancelled.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
	// A block of the planned member in another room does not make an
	// unrelated closure the member's own.
	andererRaum := testpkg.CreateTestRoom(t, db, "Musikraum Offen")
	singen := testpkg.CreateTestActivityInstance(t, db, day, andererRaum.ID, testpkg.ActivityInstanceOpts{Title: "Singen", StartHHMM: "16:00", EndHHMM: "17:00"})
	testpkg.CreateTestInstanceStaff(t, db, singen.ID, planned.ID, testpkg.InstanceStaffOpts{IsPrimary: true})

	section := func(accountID int64) string {
		t.Helper()
		_, body := read(t, router, accountID, tenantID, "rooms:read", "schedules:read")
		lines := roomClosureLines(t, body)
		require.Len(t, lines, 1, body)
		assert.Empty(t, lines[0].People, "a room closure names no person")
		return lines[0].Section
	}
	assert.Equal(t, "you", section(plannedAccount.ID), "the own block lies in the closed room")
	assert.Equal(t, "school", section(bystanderAccount.ID), "no block in the room")
	assert.Equal(t, "school", section(absentAccount.ID), "an absent supervisor is not in the room")
	assert.Equal(t, "school", section(cancelledAccount.ID), "a cancelled block does not take place")

	t.Run("without rooms:read the own block shows no closure", func(t *testing.T) {
		_, body := read(t, router, plannedAccount.ID, tenantID, "schedules:read")
		assert.Empty(t, roomClosureLines(t, body))
	})

	t.Run("without schedules:read the closure does not disclose an own block", func(t *testing.T) {
		_, body := read(t, router, plannedAccount.ID, tenantID, "rooms:read")
		lines := roomClosureLines(t, body)
		require.Len(t, lines, 1, body)
		assert.Equal(t, "school", lines[0].Section)
	})

	t.Run("the own blocks cost no statement", func(t *testing.T) {
		counter := testpkg.CaptureQueries(t, db)
		counter.Reset()
		read(t, router, plannedAccount.ID, tenantID, "rooms:read", "schedules:read")
		closed := len(counter.Queries())
		_, err := db.ExecContext(testpkg.Ctx(t), `DELETE FROM facilities.room_closures WHERE tenant_id = ? AND room_id = ?`, tenantID, werkraum.ID)
		require.NoError(t, err)
		counter.Reset()
		_, body := read(t, router, plannedAccount.ID, tenantID, "rooms:read", "schedules:read")
		require.Empty(t, roomClosureLines(t, body))
		assert.Equal(t, len(counter.Queries()), closed, "the closure of an own block's room adds no statement")
	})
}
