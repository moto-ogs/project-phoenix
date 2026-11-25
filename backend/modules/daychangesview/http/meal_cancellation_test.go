package daychangesviewhttp_test

import (
	"encoding/json"
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

// mealCancellationLines renders the cancelled lunch of the overview as
// "section reason ->link".
func mealCancellationLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind             string `json:"kind"`
				Section          string `json:"section"`
				AllDay           bool   `json:"all_day"`
				MealCancellation *struct {
					Reason string `json:"reason"`
				} `json:"meal_cancellation"`
				Link *struct {
					Target string `json:"target"`
				} `json:"link"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Kind != "meal_cancelled" {
			continue
		}
		require.NotNil(t, entry.MealCancellation)
		require.True(t, entry.AllDay)
		line := entry.Section + " " + entry.MealCancellation.Reason
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

// TestDayChangesMealCancellation is Seam 1 for the cancelled lunch (#7656):
// the school enters it over Meal Plan's staff route, the overview reads it
// through its route. Only meals:manage enters or removes it; every staff
// account of the school sees it with the school's reason, which replaces a
// changed menu of the day. Another school and the day before see nothing.
func TestDayChangesMealCancellation(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, lead := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, carer := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Betreuung")
	rig, err := api.NewDayChangesMealPlanTestRig(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	require.NoError(t, rig.Enable(testpkg.Ctx(t)))
	rig.Listen(tenantID)
	send := func(accountID, tenantID int64, method, path, body string, perms ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(accountID), tenantID, perms...)))
		return testutil.ExecuteRequestForTest(t, rig.Router, req)
	}
	cancellation := "/api/meal-plan/days/" + day.String() + "/cancellation"
	router := newRouter(t, db, day)

	t.Run("only meals:manage enters a cancellation", func(t *testing.T) {
		for name, perms := range map[string][]string{"meals:read": {"meals:read"}, "meals:register": {"meals:register", "meals:orders"}} {
			response := send(carer.ID, tenantID, http.MethodPut, cancellation, `{"reason":"Ausfall"}`, perms...)
			assert.Equal(t, http.StatusForbidden, response.Code, name+": "+response.Body.String())
		}
		assert.Equal(t, http.StatusBadRequest, send(lead.ID, tenantID, http.MethodPut, cancellation, `{"reason":"  "}`, "meals:manage").Code,
			"a cancellation needs a reason")
		count, _ := rig.Signals()
		assert.Zero(t, count, "a refused write sends no signal")
		_, body := read(t, router, carer.ID, tenantID, "users:read")
		assert.Empty(t, mealCancellationLines(t, body))
	})

	t.Run("every staff account sees the cancelled lunch with its reason", func(t *testing.T) {
		for _, dish := range []string{"Nudeln", "Eintopf"} {
			response := send(lead.ID, tenantID, http.MethodPut, "/api/meal-plan/days/"+day.String(), `{"dishes":[{"dish":"`+dish+`"}],"expected_version":"`+dayVersion(t, send, lead.ID, tenantID)+`"}`, "meals:manage")
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		}
		overview, _ := read(t, router, carer.ID, tenantID)
		require.Equal(t, []string{"school"}, mealPlanLines(overview), "the menu changed after it was published")
		response := send(lead.ID, tenantID, http.MethodPut, cancellation, `{"reason":"Der Caterer liefert nicht"}`, "meals:manage")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		count, content := rig.Signals()
		assert.Equal(t, 3, count, "both saves of the menu and the cancellation each wake the overview")
		assert.False(t, content, "the signal carries nothing")
		for name, want := range map[string]struct {
			perms []string
			line  string
		}{
			"care without meals:read": {[]string{"users:read"}, "school Der Caterer liefert nicht"},
			"no permission":           {nil, "school Der Caterer liefert nicht"},
			"meals:read":              {[]string{"meals:read"}, "school Der Caterer liefert nicht ->meal_plan"},
		} {
			overview, body := read(t, router, carer.ID, tenantID, want.perms...)
			assert.Equal(t, []string{want.line}, mealCancellationLines(t, body), name)
			assert.Empty(t, mealPlanLines(overview), name+": a cancelled lunch replaces the changed menu")
			assert.NotContains(t, body, "Eintopf", name)
			assert.Equal(t, "loaded", sourceStatus(overview, "meal_plan"), name)
		}
	})

	t.Run("the day before and another school show no cancellation", func(t *testing.T) {
		_, body := read(t, newRouter(t, db, day.AddDays(-1)), carer.ID, tenantID, "users:read")
		assert.Empty(t, mealCancellationLines(t, body))

		testpkg.OwnTenant(t)
		foreignTenant := testpkg.Tenant(t)
		_, foreign := testpkg.CreateTestStaffWithAccount(t, db, "Xaver", "Fremd")
		require.NoError(t, rig.Enable(testpkg.Ctx(t)))
		_, body = read(t, router, foreign.ID, foreignTenant, "users:read")
		assert.Empty(t, mealCancellationLines(t, body), "the cancellation of the first school stays there")
		response := send(foreign.ID, foreignTenant, http.MethodGet, "/api/meal-plan/cancellations?from="+day.String()+"&to="+day.String(), "", "meals:read")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		assert.JSONEq(t, `[]`, dataOf(t, response.Body.String()), "the list of another school is empty")
		require.Equal(t, http.StatusNoContent, send(foreign.ID, foreignTenant, http.MethodDelete, cancellation, "", "meals:manage").Code)
		count, _ := rig.Signals()
		assert.Zero(t, count, "another school's write does not reach this school")
		_, body = read(t, router, carer.ID, tenantID, "users:read")
		assert.Len(t, mealCancellationLines(t, body), 1, "another school cannot remove this school's cancellation")
	})

	t.Run("the list names the day, and removing it brings lunch back", func(t *testing.T) {
		response := send(carer.ID, tenantID, http.MethodGet, "/api/meal-plan/cancellations?from="+day.String()+"&to="+day.AddDays(2).String(), "", "meals:read")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		assert.JSONEq(t, `[{"date":"`+day.String()+`","reason":"Der Caterer liefert nicht"}]`, dataOf(t, response.Body.String()))
		assert.Equal(t, http.StatusForbidden, send(carer.ID, tenantID, http.MethodDelete, cancellation, "", "meals:read").Code)
		require.Equal(t, http.StatusNoContent, send(lead.ID, tenantID, http.MethodDelete, cancellation, "", "meals:manage").Code)
		count, _ := rig.Signals()
		assert.Equal(t, 1, count)
		overview, body := read(t, router, carer.ID, tenantID, "users:read")
		assert.Empty(t, mealCancellationLines(t, body))
		assert.Equal(t, []string{"school"}, mealPlanLines(overview), "the changed menu shows again")
	})
}

// dayVersion is the version of today as the kitchen's page reads it.
func dayVersion(t *testing.T, send func(int64, int64, string, string, string, ...string) *httptest.ResponseRecorder, accountID, tenantID int64) string {
	t.Helper()
	response := send(accountID, tenantID, http.MethodGet, "/api/meal-plan/days?week_start="+day.StartOfISOWeek().String(), "", "meals:read")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var week struct {
		Data []struct {
			Date    string `json:"date"`
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &week))
	for _, read := range week.Data {
		if read.Date == day.String() {
			return read.Version
		}
	}
	return ""
}

// dataOf is the data member of a success envelope.
func dataOf(t *testing.T, body string) string {
	t.Helper()
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	return string(envelope.Data)
}
