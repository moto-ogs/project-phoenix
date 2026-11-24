// Router-level tests for the stop of room history and mood of a holiday
// guest (#8037, ADR 0120 addendum of 2026-11-24): while the home school
// holds a stop for the child, the hosting school keeps no closed room visit
// of its guest and takes no mood, without a stop row of its own.
package api

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestRoomHistoryStopOfTheHomeSchoolHoldsForTheHolidayGuestAtOnce(t *testing.T) {
	t.Parallel()
	g := newHostedHolidayGuests(t, "Träger Raumverlauf-Stopp")
	f, tom, ben := g.f, g.tom, g.ben
	exec := g.exec(t)
	_, family := g.homeFamily(t)

	presence, err := NewCheckinTestPresence(testpkg.NewDatabase(t, f.db))
	require.NoError(t, err)
	moodStopped := func(school, student int64) bool {
		t.Helper()
		var stopped bool
		require.NoError(t, testpkg.WithinTenantContext(t, testpkg.ContextForTenant(testpkg.Ctx(t), school), f.db, school, func(ctx context.Context) error {
			var err error
			stopped, err = presence.(studentpresence.RoomHistoryStopOwner).MoodCaptureStopped(ctx, student)
			return err
		}))
		return stopped
	}
	closedVisits := func(student int64) int {
		t.Helper()
		var rows int
		require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM active.visits WHERE tenant_id = ? AND student_id = ? AND exit_time IS NOT NULL`,
			f.nord, student).Scan(t.Context(), &rows))
		return rows
	}
	room := testpkg.CreateTestActiveGroupForTenant(t, f.db, f.nord)
	entry := time.Date(2099, 7, 6, 8, 0, 0, 0, time.UTC)
	visit := func(student int64, at time.Time) {
		t.Helper()
		exec(`INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time) VALUES (?, ?, ?, ?)`, f.nord, student, room.ID, at)
		exec(`UPDATE active.visits SET exit_time = ? WHERE tenant_id = ? AND student_id = ? AND exit_time IS NULL`, at.Add(time.Hour), f.nord, student)
	}

	assert.Nil(t, g.sheet(t, ben).HomeRoomHistoryStopped, "a guest without a home school of the Träger has no answer")
	stopped := g.sheet(t, tom).HomeRoomHistoryStopped
	require.NotNil(t, stopped, "a guest of a school of the Träger has an answer")
	assert.False(t, *stopped)
	assert.False(t, moodStopped(f.nord, tom))
	visit(tom, entry)
	visit(ben, entry)
	require.Equal(t, 1, closedVisits(tom), "without a stop the hosting school keeps the room history")

	// The home school stops room history and mood of its child. The hosting
	// school holds no stop row; its next read and its next visit obey.
	exec(`INSERT INTO active.room_history_stops (tenant_id, student_id, stopped_at) VALUES (?, ?, NOW())`, family.TenantID, family.StudentID)
	assert.True(t, *g.sheet(t, tom).HomeRoomHistoryStopped, "the stop of the home school shows at the hosting school at once")
	assert.True(t, moodStopped(f.nord, tom), "the hosting school takes no mood of the guest")
	assert.False(t, moodStopped(f.nord, ben), "another guest is not stopped")
	var ownStops int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM active.room_history_stops WHERE tenant_id = ?`, f.nord).Scan(t.Context(), &ownStops))
	assert.Zero(t, ownStops, "nothing is copied to the hosting school")

	exec(`INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time) VALUES (?, ?, ?, ?)`, f.nord, tom, room.ID, entry.Add(2*time.Hour))
	var open int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM active.visits WHERE tenant_id = ? AND student_id = ? AND exit_time IS NULL`, f.nord, tom).Scan(t.Context(), &open))
	assert.Equal(t, 1, open, "the current room of the guest stays visible")
	assert.Equal(t, 1, closedVisits(tom), "an open visit deletes nothing")
	exec(`UPDATE active.visits SET exit_time = ? WHERE tenant_id = ? AND student_id = ? AND exit_time IS NULL`, entry.Add(3*time.Hour), f.nord, tom)
	assert.Zero(t, closedVisits(tom), "the closed visit goes, and the one stored before the stop with it")
	assert.Equal(t, 1, closedVisits(ben), "another guest keeps its history")

	t.Run("only the hosting school of the guest is told", func(t *testing.T) {
		var allowed bool
		require.NoError(t, f.db.NewRaw(`SELECT has_function_privilege('phoenix_tenant', 'enrollment.holiday_guest_home_children(bigint, bigint)', 'EXECUTE')`).Scan(t.Context(), &allowed))
		assert.False(t, allowed, "no tenant role names the hosting school itself")
		ask := func(school int64) *bool {
			t.Helper()
			var answer *bool
			require.NoError(t, f.db.NewRaw(`WITH scope AS MATERIALIZED (SELECT set_config('app.current_tenant_id', ?, true))
				SELECT enrollment.holiday_guest_home_room_history_stopped(?) FROM scope`, fmt.Sprint(school), tom).Scan(t.Context(), &answer))
			return answer
		}
		assert.True(t, *ask(f.nord))
		assert.Nil(t, ask(family.TenantID), "the home school hosts nothing")
		assert.Nil(t, ask(int64(f.offer.Schools[1].ID)), "another school of the Träger hosts nothing")
	})

	t.Run("a namesake at the home school does not lose the stop", func(t *testing.T) {
		twin := testpkg.CreateTestStudentForTenant(t, f.db, family.TenantID, "Tom", "Beispiel", "1a")
		exec(`UPDATE users.persons SET birthday = '2017-05-20' WHERE id = ?`, twin.PersonID)
		assert.True(t, *g.sheet(t, tom).HomeRoomHistoryStopped, "the stop of one of the fitting children counts")
		exec(`UPDATE users.student_school_memberships SET enrolled_from = '2090-01-01', enrolled_until = '2098-12-31' WHERE student_profile_id = ?`, twin.ID)
	})

	t.Run("a lifted stop lets the hosting school store again", func(t *testing.T) {
		exec(`DELETE FROM active.room_history_stops WHERE tenant_id = ? AND student_id = ?`, family.TenantID, family.StudentID)
		assert.False(t, *g.sheet(t, tom).HomeRoomHistoryStopped)
		assert.False(t, moodStopped(f.nord, tom))
		visit(tom, entry.Add(4*time.Hour))
		assert.Equal(t, 1, closedVisits(tom))
	})

	t.Run("a guest that ended keeps its history", func(t *testing.T) {
		exec(`INSERT INTO active.room_history_stops (tenant_id, student_id, stopped_at) VALUES (?, ?, NOW())`, family.TenantID, family.StudentID)
		exec(`UPDATE enrollment.holiday_guests SET ended_on = '2099-07-06' WHERE student_id = ?`, tom)
		assert.False(t, moodStopped(f.nord, tom), "the stop of the home school ends with the booking")
		visit(tom, entry.Add(6*time.Hour))
		assert.Equal(t, 2, closedVisits(tom))
	})
}
