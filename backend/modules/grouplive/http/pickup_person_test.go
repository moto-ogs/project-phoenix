package grouplivehttp_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The group view shows who collects a child today at the child's pickup
// (#7655), next to the day's Abholart, from the same read. A guest with
// students:read only sees no pickup data, and so no pickup person.
func TestOGSGroupLiveShowsTheDayPickupPerson(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock)
	teacher, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Abhol", "Gruppe")
	group := testpkg.CreateTestEducationGroup(t, tc.db, "Abholgruppe")
	today := calendar.Date("2026-08-24")
	pickup := func(first string) int64 {
		child := testpkg.CreateTestStudent(t, tc.db, first, "Kind", "2a")
		testpkg.AssignStudentToGroup(t, tc.db, child.ID, group.ID)
		testpkg.CreateTestPickupScheduleWithNote(t, tc.db, child.ID, 1, teacher.StaffID, "15:30", "")
		return child.ID
	}
	mila := pickup("Mila")
	testpkg.CreateTestPickupPerson(t, tc.db, mila, today, teacher.StaffID, "Tante Frieda", 0)
	testpkg.CreateTestDepartureException(t, tc.db, mila, today, teacher.StaffID, "pickup", "")
	pickup("Ben")

	read := func(granted ...string) []map[string]any {
		req := testutil.NewRequest("GET", fmt.Sprintf("/ogs-group-live?group_id=%d", group.ID), nil)
		rr := authExec(t, tc, req, testutil.TeacherTestClaims(int(account.ID)), granted)
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		return decodeOGSLive(t, rr.Body.Bytes()).Data.PickupTimes
	}

	byStudent := map[string]map[string]any{}
	for _, row := range read("users:read", "groups:read") {
		byStudent[fmt.Sprint(row["student_id"])] = row
	}
	require.Len(t, byStudent, 2)
	assert.Equal(t, map[string]any{"name": "Tante Frieda", "one_time": true}, byStudent[fmt.Sprint(mila)]["day_pickup_person"])
	assert.Equal(t, "pickup", byStudent[fmt.Sprint(mila)]["day_departure_mode"])
	for id, row := range byStudent {
		if id != fmt.Sprint(mila) {
			assert.NotContains(t, row, "day_pickup_person", "a child without a pickup person of the day")
		}
	}

	assert.Empty(t, read("students:read", "groups:read"), "a guest sees no pickup data")
}
