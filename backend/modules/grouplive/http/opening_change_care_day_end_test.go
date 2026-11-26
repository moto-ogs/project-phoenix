package grouplivehttp_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The care day of the live group ends at the changed closing time of the day
// (#8157): an expected child without check-in and pickup time reads "Schule"
// only until then. Another school keeps its regular session end.
func TestOGSGroupLive_ChangedClosingTimeEndsTheCareDay(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock) // Monday 12:00 Berlin
	today := calendar.DateFromTime(fixedCalendarClock())

	liveLocation := func(t *testing.T) string {
		t.Helper()
		teacher, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Opening", "Leitung")
		group := testpkg.CreateTestEducationGroup(t, tc.db, "Opening-8157")
		testpkg.CreateTestGroupTeacher(t, tc.db, group.ID, teacher.ID)
		child := testpkg.CreateTestStudent(t, tc.db, "Expected", "Child", "OC1")
		testpkg.AssignStudentToGroup(t, tc.db, child.ID, group.ID)
		testpkg.CreateTestArrivalSchedule(t, tc.db, child.ID, 1, teacher.StaffID, "08:00") // Monday

		req := testutil.NewRequest("GET", fmt.Sprintf("/ogs-group-live?group_id=%d", group.ID), nil)
		rr := authExec(t, tc, req, testutil.TeacherTestClaims(int(account.ID)), ogsLivePerms)
		require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())
		students := decodeOGSLive(t, rr.Body.Bytes()).Data.Students
		require.Len(t, students, 1)
		return fmt.Sprint(students[0]["current_location"])
	}

	require.NoError(t, testpkg.WithinTenantContext(t, testpkg.Ctx(t), tc.db, testpkg.Tenant(t), func(txCtx context.Context) error {
		return api.CreateOpeningChangeFixture(txCtx, today, "11:30")
	}))
	assert.Equal(t, "Abwesend", liveLocation(t), "the school closed at 11:30 today")

	t.Run("andere Schule", func(t *testing.T) {
		testpkg.OwnTenant(t)
		assert.Equal(t, "Schule", liveLocation(t), "the change of one school leaves another open")
	})
}
