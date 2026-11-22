package presence_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestStafflessSessionIsRefusedNotUnauthenticated pins #7818 through the
// production router and the real people directory: a valid school session
// whose account has no person or no staff record at the school, a session the
// Träger-Büro opened through the Absprung included, may neither check a child
// in nor take over a supervision. Both answer 403, never 401, each with its
// own code.
func TestStafflessSessionIsRefusedNotUnauthenticated(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)

	room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Staffless Room %d", testpkg.UniqueSuffix()))
	activityGroup := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("Staffless Activity %d", testpkg.UniqueSuffix()))
	activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, activityGroup.ID, room.ID)
	student := testpkg.CreateTestStudent(t, tc.db, "Staffless", "Child", "1a")

	withoutPerson := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("staffless-admin-%d@example.com", testpkg.UniqueSuffix()))
	_, withPerson := testpkg.CreateTestPersonWithAccount(t, tc.db, "Staffless", "Admin")
	traegerAccount := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("traeger-buero-%d@example.com", testpkg.UniqueSuffix()))
	traeger := testutil.AdminTestClaims(int(traegerAccount.ID))
	traeger.ViaTraeger = true
	callers := map[string]testutil.Claims{
		"admin without person":        testutil.AdminTestClaims(int(withoutPerson.ID)),
		"admin with person, no staff": testutil.AdminTestClaims(int(withPerson.ID)),
		"Träger session via Absprung": traeger,
	}

	checkIn := map[string]any{"student_ids": []string{fmt.Sprint(student.ID)}, "target_active_group_id": fmt.Sprint(activeGroup.ID)}
	for name, claims := range callers {
		rr := testutil.ExecuteWithAuthPermissions(t, router, testutil.NewJSONRequest(t, "POST", "/active/visits/check-in-to-group", checkIn), claims, []string{"admin:*"})
		require.Equalf(t, http.StatusForbidden, rr.Code, "%s check-in: %s", name, rr.Body.String())
		assert.Containsf(t, rr.Body.String(), `"code":"`+common.CodeAttendanceCheckinStaffProfileRequired+`"`, "%s check-in", name)

		rr = testutil.ExecuteWithAuthPermissions(t, router, testutil.NewJSONRequest(t, "POST", fmt.Sprintf("/active/groups/%d/claim", activeGroup.ID), nil), claims, []string{"admin:*"})
		require.Equalf(t, http.StatusForbidden, rr.Code, "%s claim: %s", name, rr.Body.String())
		assert.Containsf(t, rr.Body.String(), `"code":"`+common.CodeTimetableNoStaffProfile+`"`, "%s claim", name)
	}
}
