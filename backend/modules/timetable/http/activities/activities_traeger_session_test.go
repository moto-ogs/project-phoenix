package httpadapter_test

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// traegerActivityClaims open the school the way the Träger-Büro does through
// the Absprung (ADR 0084 section 5): the school's admin role, no person and
// no staff record at the school (#7818).
func traegerActivityClaims(t *testing.T, tc *testContext) testutil.Claims {
	t.Helper()
	account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("traeger-activity-%d@example.com", testpkg.UniqueSuffix()))
	claims := testutil.AdminTestClaims(int(account.ID))
	claims.ViaTraeger = true
	return claims
}

// createdActivity reads the creator and the planned supervisors of an activity.
func createdActivity(t *testing.T, tc *testContext, data map[string]any, key string) (createdBy *int64, supervisors int64) {
	t.Helper()
	id, err := strconv.ParseInt(fmt.Sprint(data[key]), 10, 64)
	require.NoError(t, err)
	err = tc.db.NewSelect().ColumnExpr("created_by").TableExpr("activities.groups").
		Where("id = ?", id).Scan(context.Background(), &createdBy)
	require.NoError(t, err)
	count, err := tc.db.NewSelect().TableExpr("activities.supervisors").
		Where("group_id = ?", id).Count(context.Background())
	require.NoError(t, err)
	return createdBy, count
}

// TestTraegerSchoolSessionQuickCreatesActivityWithoutSupervisor pins #7818:
// the Träger-Büro creates an activity without a staff owner and without a
// supervisor, since it is none.
func TestTraegerSchoolSessionQuickCreatesActivityWithoutSupervisor(t *testing.T) {
	t.Parallel()
	tc := setupActivitiesRoute(t)
	category := testpkg.CreateTestActivityCategory(t, tc.db, fmt.Sprintf("TraegerQuick-%d", testpkg.UniqueSuffix()))
	body := map[string]any{"name": fmt.Sprintf("TraegerQuick-%d", testpkg.UniqueSuffix()), "category_id": category.ID, "max_participants": 10}

	rr := testutil.ExecuteWithAuth(t, tc.router, testutil.NewAuthenticatedRequest(t, http.MethodPost, "/activities/quick-create", body),
		traegerActivityClaims(t, tc))

	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	data, ok := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	require.True(t, ok)
	assert.Empty(t, data["supervisor_name"], "the Träger-Büro is no supervisor")
	createdBy, supervisors := createdActivity(t, tc, data, "activity_id")
	assert.Nil(t, createdBy, "created_by stays empty: no staff owns the activity")
	assert.Zero(t, supervisors, "no planned supervisor")
}

// TestTraegerSchoolSessionCreatesActivityWithChosenSupervisors pins that the
// full form of the Träger-Büro plans the supervisors it names.
func TestTraegerSchoolSessionCreatesActivityWithChosenSupervisors(t *testing.T) {
	t.Parallel()
	tc := setupActivitiesRoute(t)
	staff := testpkg.CreateTestStaff(t, tc.db, "Traeger", "Leitung")
	category := testpkg.CreateTestActivityCategory(t, tc.db, fmt.Sprintf("TraegerCreate-%d", testpkg.UniqueSuffix()))
	body := map[string]any{
		"name": fmt.Sprintf("TraegerCreate-%d", testpkg.UniqueSuffix()), "max_participants": 15, "is_open": true,
		"category_id": category.ID, "supervisor_ids": []string{strconv.FormatInt(staff.ID, 10)},
	}

	rr := testutil.ExecuteWithAuth(t, tc.router, testutil.NewAuthenticatedRequest(t, http.MethodPost, "/activities", body),
		traegerActivityClaims(t, tc))

	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	data, ok := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	require.True(t, ok)
	createdBy, supervisors := createdActivity(t, tc, data, "id")
	assert.Nil(t, createdBy)
	assert.EqualValues(t, 1, supervisors, "the named supervisor is planned")
}

// TestCreateActivityRefusesAccountWithoutStaffProfile pins the refusal of an
// account that is neither staff of the school nor the Träger-Büro.
func TestCreateActivityRefusesAccountWithoutStaffProfile(t *testing.T) {
	t.Parallel()
	tc := setupActivitiesRoute(t)
	account := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("no-staff-activity-%d@example.com", testpkg.UniqueSuffix()))
	category := testpkg.CreateTestActivityCategory(t, tc.db, fmt.Sprintf("NoStaff-%d", testpkg.UniqueSuffix()))
	for path, body := range map[string]map[string]any{
		"/activities":              {"name": "NoStaff", "max_participants": 15, "is_open": true, "category_id": category.ID},
		"/activities/quick-create": {"name": "NoStaffQuick", "category_id": category.ID, "max_participants": 10},
	} {
		rr := testutil.ExecuteWithAuth(t, tc.router, testutil.NewAuthenticatedRequest(t, http.MethodPost, path, body),
			testutil.AdminTestClaims(int(account.ID)))
		assert.Equal(t, http.StatusForbidden, rr.Code, "%s: %s", path, rr.Body.String())
		assert.Contains(t, rr.Body.String(), fmt.Sprintf("%q:%q", "code", common.CodeTimetableNoStaffProfile), path)
	}
}
