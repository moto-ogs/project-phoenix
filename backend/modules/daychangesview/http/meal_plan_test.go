package daychangesviewhttp_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// mealPlanLines renders the Essen entries as "section all_day ->link".
func mealPlanLines(overview wireOverview) []string {
	lines := []string{}
	for _, entry := range overview.Entries {
		if entry.Kind != "meal_plan_changed" {
			continue
		}
		line := entry.Section
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

// TestDayChangesMealPlanSource is Seam 1 for Essen (#7666): the kitchen
// saves the menu over Meal Plan's staff route, the overview reads it through
// its route. Only a change of a published menu is a change; every staff
// account sees it, without the dishes and also without meals:read.
func TestDayChangesMealPlanSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, kitchen := testpkg.CreateTestStaffWithAccount(t, db, "Kai", "Küche")
	_, carer := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Betreuung")
	rig, err := api.NewDayChangesMealPlanTestRig(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	require.NoError(t, rig.Enable(testpkg.Ctx(t)))
	rig.Listen(tenantID)
	save := func(accountID, tenantID int64, date, dishes string) int {
		req := httptest.NewRequest(http.MethodPut, "/api/meal-plan/"+date, strings.NewReader(`{"dishes":[`+dishes+`]}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(accountID), tenantID, "admin:*")))
		return testutil.ExecuteRequestForTest(t, rig.Router, req).Code
	}
	router := newRouter(t, db, day)

	t.Run("a menu as first published is no change", func(t *testing.T) {
		require.Equal(t, http.StatusOK, save(kitchen.ID, tenantID, day.String(), `{"dish":"Nudeln mit Tomatensoße"}`))
		overview, _ := read(t, router, carer.ID, tenantID, "users:read")
		assert.Empty(t, mealPlanLines(overview))
		assert.Equal(t, "loaded", sourceStatus(overview, "meal_plan"))
	})

	t.Run("a changed menu wakes the overview without content", func(t *testing.T) {
		require.Equal(t, http.StatusOK, save(kitchen.ID, tenantID, day.String(), `{"dish":"Gemüseeintopf"}`))
		count, content := rig.Signals()
		assert.Equal(t, 2, count, "one signal per committed save of a day")
		assert.False(t, content, "the signal carries nothing")
		assert.NotEqual(t, http.StatusOK, save(kitchen.ID, tenantID, day.AddDays(3).String(), `{"dish":"Samstag"}`))
		count, _ = rig.Signals()
		assert.Zero(t, count, "a refused save sends no signal")
	})

	t.Run("every staff account sees the short note without the dishes", func(t *testing.T) {
		for name, perms := range map[string][]string{"care without meals:read": {"users:read"}, "lead": {"admin:*"}, "no permission": nil} {
			overview, body := read(t, router, carer.ID, tenantID, perms...)
			assert.Equal(t, []string{"school ->meal_plan"}, mealPlanLines(overview), name)
			for _, dish := range []string{"Gemüseeintopf", "Nudeln"} {
				assert.NotContains(t, body, dish, name)
			}
		}
	})

	t.Run("saving the same menu again keeps the change", func(t *testing.T) {
		require.Equal(t, http.StatusOK, save(kitchen.ID, tenantID, day.String(), `{"dish":"Gemüseeintopf"}`))
		overview, _ := read(t, router, carer.ID, tenantID)
		assert.Equal(t, []string{"school ->meal_plan"}, mealPlanLines(overview))
		count, _ := rig.Signals()
		assert.Equal(t, 1, count, "every committed save signals; the reader decides")
	})

	t.Run("the day before and another school show no change", func(t *testing.T) {
		overview, _ := read(t, newRouter(t, db, day.AddDays(-1)), carer.ID, tenantID, "users:read")
		assert.Empty(t, mealPlanLines(overview))

		testpkg.OwnTenant(t)
		foreignTenant := testpkg.Tenant(t)
		_, foreign := testpkg.CreateTestStaffWithAccount(t, db, "Xaver", "Fremd")
		require.NoError(t, rig.Enable(testpkg.Ctx(t)))
		overview, _ = read(t, router, foreign.ID, foreignTenant, "users:read")
		assert.Empty(t, mealPlanLines(overview), "the change of the first school stays there")
		require.Equal(t, http.StatusOK, save(foreign.ID, foreignTenant, day.String(), `{"dish":"Fremd"}`))
		require.Equal(t, http.StatusOK, save(foreign.ID, foreignTenant, day.String(), `{"dish":"Fremd geändert"}`))
		count, _ := rig.Signals()
		assert.Zero(t, count, "another school's save does not reach this school")
	})
}
