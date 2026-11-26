package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// checkNoStaffProfileOwnRoutes signs in a school admin without a staff
// profile, as a Träger person switching into a school is (#7306), and reads
// the own time tracking and calendar through the production router. The
// admin role passes the permission gate; the own data needs a staff profile,
// so both routes refuse with their own code instead of 401 or a generic 403.
func checkNoStaffProfileOwnRoutes(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	// One admin without any person in the school, one with a person but no
	// staff record: both lack the staff profile the own data needs.
	withoutPerson := testpkg.CreateTestAccount(t, db, "admin-ohne-person")
	_, withPerson := testpkg.CreateTestPersonWithAccount(t, db, "Admin", "OhnePersonal")
	for name, accountID := range map[string]int64{"without person": withoutPerson.ID, "person without staff": withPerson.ID} {
		testpkg.EnsureAccountTenant(t, db, accountID, tenantID)
		claims := testpkg.TenantUserTestClaims(int(accountID), tenantID, permissions.TimeTrackingOwn, permissions.CalendarOwn)
		claims.Roles = []string{"admin"}
		claims.IsAdmin = true
		token := testpkg.MintLiveSessionJWT(t, db, claims)

		for path, code := range map[string]string{
			"/api/time-tracking/current":                              "workforce.no_staff_profile",
			"/api/time-tracking/period?view=week&start=2026-01-05":    "workforce.no_staff_profile",
			"/api/time-tracking/overview":                             "workforce.no_staff_profile",
			"/api/time-tracking/leave-overview":                       "workforce.no_staff_profile",
			"/api/time-tracking/shifts?from=2026-01-05&to=2026-01-11": "workforce.no_staff_profile",
			"/api/calendar/my?from=2026-01-05&to=2026-01-11":          "calendar.no_staff_profile",
		} {
			response := checkpointRequest(api, checkpointScenario{Method: http.MethodGet, Path: path, Authenticated: true}, token)
			require.Equalf(t, http.StatusForbidden, response.Code, "%s: GET %s: %s", name, path, response.Body.String())
			assert.Containsf(t, response.Body.String(), `"code":"`+code+`"`, "%s: GET %s", name, path)
		}
	}
}
