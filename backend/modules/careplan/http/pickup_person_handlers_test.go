package careplanhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pickupPersonWire is one entry of pickup_persons in the pickup data.
type pickupPersonWire struct {
	ExceptionDate     string      `json:"exception_date"`
	Name              string      `json:"name"`
	GuardianProfileID *testpkg.ID `json:"guardian_profile_id"`
	OneTime           bool        `json:"one_time"`
}

// The OGS names who collects a child on one day (#7655): a contact with a
// standing pickup permission on that weekday, or a one-time person by name.
// The value shows in the child's pickup data, replaces itself per day and
// goes with the delete. A contact without the permission, a past day, a
// weekend, a body with both or neither person, a child of another school and
// an account without users:update are refused.
func TestStudentPickupPersonRoutes(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t, fixedCalendarClock)
	student := testpkg.CreateTestStudent(t, tc.db, "Abhol", "Kind", "AP1")
	_, account := testpkg.CreateTestTeacherWithAccount(t, tc.db, "Abhol", "Teacher")
	admin := testutil.AdminTestClaims(int(account.ID))
	grandma := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Oma", "Berta", "oma-berta")
	testpkg.CreateTestStudentGuardianLink(t, tc.db, student.ID, grandma.ID, "pickup_only")
	neighbour := testpkg.CreateTestGuardianProfileNamed(t, tc.db, "Nachbar", "Kurt", "nachbar-kurt")
	unauthorized := &testpkg.StudentGuardian{StudentID: student.ID, GuardianProfileID: neighbour.ID, RelationshipType: "other", EmergencyPriority: 2}
	unauthorized.TenantID = testpkg.Tenant(t)
	require.NoError(t, testpkg.InsertTestStudentGuardian(testpkg.Ctx(t), tc.db, unauthorized))
	tuesday, wednesday := studentsTestToday.AddDays(1), studentsTestToday.AddDays(2)

	put := func(claims sessiontoken.AppClaims, perms []string, studentID int64, date calendar.Date, body map[string]any) (int, string) {
		req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/%d/pickup-persons/%s", studentID, date), body)
		rr := authExec(t, tc, req, claims, perms)
		return rr.Code, rr.Body.String()
	}
	adminPut := func(date calendar.Date, body map[string]any) (int, string) {
		return put(admin, []string{"admin:*"}, student.ID, date, body)
	}

	t.Run("a contact with the pickup permission and a one-time person", func(t *testing.T) {
		code, body := adminPut(studentsTestToday, map[string]any{"guardian_profile_id": fmt.Sprint(grandma.ID)})
		require.Equal(t, http.StatusOK, code, body)
		assert.Contains(t, body, `"name":"Oma Berta"`)
		assert.Contains(t, body, `"one_time":false`)

		code, body = adminPut(tuesday, map[string]any{"name": "  Tante   Frieda "})
		require.Equal(t, http.StatusOK, code, body)
		// Saving the day again replaces its person; there is one per day.
		code, body = adminPut(tuesday, map[string]any{"name": "Onkel Ali"})
		require.Equal(t, http.StatusOK, code, body)

		persons := listedPickupPersons(t, tc, admin, student.ID, studentsTestToday)
		require.Len(t, persons, 2)
		assert.Equal(t, studentsTestToday.String(), persons[0].ExceptionDate)
		assert.Equal(t, "Oma Berta", persons[0].Name)
		require.NotNil(t, persons[0].GuardianProfileID)
		assert.Equal(t, grandma.ID, int64(*persons[0].GuardianProfileID))
		assert.Equal(t, pickupPersonWire{ExceptionDate: tuesday.String(), Name: "Onkel Ali", OneTime: true}, persons[1])
	})

	t.Run("refusals", func(t *testing.T) {
		code, body := adminPut(wednesday, map[string]any{"guardian_profile_id": fmt.Sprint(neighbour.ID)})
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Contains(t, body, common.CodeCarePickupPersonNotAuthorized, "a contact without the pickup permission")

		_, err := tc.db.ExecContext(testpkg.Ctx(t), `UPDATE users.student_guardian_pickup_permissions SET pickup_weekdays = '{1}'
			WHERE tenant_id = ? AND relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE tenant_id = ? AND guardian_profile_id = ?)`,
			testpkg.Tenant(t), testpkg.Tenant(t), grandma.ID)
		require.NoError(t, err)
		code, body = adminPut(wednesday, map[string]any{"guardian_profile_id": fmt.Sprint(grandma.ID)})
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Contains(t, body, common.CodeCarePickupPersonNotAuthorized, "a permission for Mondays only")

		for name, request := range map[string]struct {
			date calendar.Date
			body map[string]any
		}{
			"past day":       {studentsTestToday.AddDays(-1), map[string]any{"name": "Gestern"}},
			"weekend":        {studentsTestToday.AddDays(5), map[string]any{"name": "Samstag"}},
			"both persons":   {wednesday, map[string]any{"name": "Beide", "guardian_profile_id": fmt.Sprint(grandma.ID)}},
			"neither person": {wednesday, map[string]any{"name": "  "}},
			"too long name":  {wednesday, map[string]any{"name": strings.Repeat("a", 121)}},
		} {
			code, body := adminPut(request.date, request.body)
			assert.Equal(t, http.StatusBadRequest, code, "%s: %s", name, body)
		}

		code, body = put(admin, []string{"users:read"}, student.ID, wednesday, map[string]any{"name": "Ohne Recht"})
		assert.Equal(t, http.StatusForbidden, code, body)

		otherTenant, _ := testpkg.CreateTestTenant(t, tc.db)
		foreign := testpkg.CreateTestStudentForTenant(t, tc.db, otherTenant, "Fremd", "Kind", "AP2")
		code, body = put(admin, []string{"admin:*"}, foreign.ID, wednesday, map[string]any{"name": "Fremde Schule"})
		assert.Equal(t, http.StatusNotFound, code, body)

		persons := listedPickupPersons(t, tc, admin, student.ID, studentsTestToday)
		assert.Len(t, persons, 2, "no refusal wrote a day value")
	})

	t.Run("a past day shows no person, also before the nightly retention", func(t *testing.T) {
		testpkg.CreateTestPickupPerson(t, tc.db, student.ID, studentsTestToday.AddDays(-1), 0, "Gestern", 0)
		persons := listedPickupPersons(t, tc, admin, student.ID, studentsTestToday.AddDays(-1))
		require.Len(t, persons, 2)
		assert.Equal(t, studentsTestToday.String(), persons[0].ExceptionDate)
	})

	t.Run("delete", func(t *testing.T) {
		req := testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/%d/pickup-persons/%s", student.ID, tuesday), nil)
		rr := authExec(t, tc, req, admin, []string{"admin:*"})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		persons := listedPickupPersons(t, tc, admin, student.ID, studentsTestToday)
		require.Len(t, persons, 1)
		assert.Equal(t, studentsTestToday.String(), persons[0].ExceptionDate)
	})
}

// listedPickupPersons reads the pickup persons of the child's pickup data
// for the week from from.
func listedPickupPersons(t *testing.T, tc *testContext, claims sessiontoken.AppClaims, studentID int64, from calendar.Date) []pickupPersonWire {
	t.Helper()
	req := testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/pickup-schedules?from=%s&to=%s", studentID, from, from.AddDays(6)), nil)
	rr := authExec(t, tc, req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var response struct {
		Data struct {
			PickupPersons []pickupPersonWire `json:"pickup_persons"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	return response.Data.PickupPersons
}
