package daychangesviewhttp_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// bookMeals books the child on every weekday from the Monday of day's week.
func bookMeals(t *testing.T, db *testpkg.DB, tenantID, studentID, accountID int64) {
	t.Helper()
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO schedule.meal_participation_schedules
  (tenant_id, student_id, effective_from, monday, tuesday, wednesday, thursday, friday, changed_by_account_id)
  VALUES (?, ?, ?, TRUE, TRUE, TRUE, TRUE, TRUE, ?)`, tenantID, studentID, day.StartOfISOWeek(), accountID)
	require.NoError(t, err)
}

// childMealLines are the kinds of the child's day that concern lunch.
func childMealLines(answer childDayWire) []string {
	lines := []string{}
	for _, entry := range answer.Entries {
		if entry.Kind == "meal_cancelled" {
			lines = append(lines, entry.Kind)
		}
	}
	return lines
}

// TestMealCancellationInTheParentsPortal is Seam 1 of the cancelled lunch
// in the parents portal (#8160). The school enters it over Meal Plan's
// staff route. The child's day shows it only for a child booked on the day,
// behind parent_portal.access, without the school's reason. The day before,
// a booked child of another school and the removed cancellation show
// nothing.
func TestMealCancellationInTheParentsPortal(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	ctx := testpkg.Ctx(t)
	_, lead := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	rig, err := api.NewDayChangesMealPlanTestRig(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
	require.NoError(t, err)
	require.NoError(t, rig.Enable(ctx))
	require.NoError(t, rig.EnableRegistration(ctx))

	// Felix is booked; his sibling Mia is not, and Jonas cancelled today's
	// meal; Lena is booked, but her guardian lacks parent_portal.access;
	// Sara is booked and sick today: her booking still stands.
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
	bookMeals(t, db, tenantID, chain.StudentID, lead.ID)
	mia := testpkg.CreateTestStudent(t, db, "Mia", "Schneider", "2b")
	testpkg.CreateTestStudentGuardianLink(t, db, mia.ID, chain.GuardianProfileID, "primary_guardian")
	lena := testpkg.CreateTestStudent(t, db, "Lena", "Schneider", "3c")
	lenaLink := testpkg.CreateTestStudentGuardianLink(t, db, lena.ID, chain.GuardianProfileID, "pickup_only")
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, lenaLink.ID, map[string]interface{}{"parent_portal.access": false}))
	bookMeals(t, db, tenantID, lena.ID, lead.ID)
	sara := testpkg.CreateTestStudent(t, db, "Sara", "Schneider", "4a")
	testpkg.CreateTestStudentGuardianLink(t, db, sara.ID, chain.GuardianProfileID, "primary_guardian")
	bookMeals(t, db, tenantID, sara.ID, lead.ID)
	testpkg.CreateTestStudentStatusDay(t, db, sara.ID, day, "sick")
	jonas := testpkg.CreateTestStudent(t, db, "Jonas", "Schneider", "1b")
	testpkg.CreateTestStudentGuardianLink(t, db, jonas.ID, chain.GuardianProfileID, "primary_guardian")
	bookMeals(t, db, tenantID, jonas.ID, lead.ID)
	_, err = db.ExecContext(ctx, `INSERT INTO schedule.meal_participation_overrides
  (tenant_id, student_id, date, participating, changed_by_account_id) VALUES (?, ?, ?, FALSE, ?)`, tenantID, jonas.ID, day, lead.ID)
	require.NoError(t, err)

	send := func(method, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/meal-plan/days/"+day.String()+"/cancellation", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(lead.ID), tenantID, "meals:manage")))
		return testutil.ExecuteRequestForTest(t, rig.Router, req)
	}
	parents := func(today calendar.Date) chi.Router {
		inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), today)
		require.NoError(t, err)
		router := chi.NewRouter()
		router.Use(testpkg.TenantRuntimeMiddleware(t, db))
		router.Mount("/", inner)
		return router
	}
	parentToday, parentYesterday := parents(day), parents(day.AddDays(-1))

	t.Run("without a cancellation nobody sees one", func(t *testing.T) {
		code, answer, body := readChildDay(t, parentToday, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Empty(t, childMealLines(answer))
		assert.Equal(t, "loaded", childSourceStatus(answer, "meal_plan"))
	})

	response := send(http.MethodPut, `{"reason":"Der Caterer liefert nicht"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	t.Run("the parents see it only for a booked child, without the reason", func(t *testing.T) {
		code, answer, body := readChildDay(t, parentToday, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"meal_cancelled"}, childMealLines(answer))
		assert.NotContains(t, body, "Caterer", "the school's reason stays with the team")
		code, answer, body = readChildDay(t, parentToday, token, sara.ID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Equal(t, []string{"meal_cancelled"}, childMealLines(answer), "a sick child keeps its booking")
		for name, id := range map[string]int64{"not booked": mia.ID, "cancelled for the day": jonas.ID} {
			code, answer, body = readChildDay(t, parentToday, token, id)
			require.Equal(t, http.StatusOK, code, body)
			assert.Empty(t, childMealLines(answer), name)
		}
		code, _, body = readChildDay(t, parentToday, token, lena.ID)
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
		assert.NotContains(t, body, "meal_cancelled", "without parent_portal.access the child's day stays closed")
		code, answer, body = readChildDay(t, parentYesterday, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Empty(t, childMealLines(answer), "the day before shows no cancellation")
	})

	t.Run("another school sees nothing of it", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreignTenant := testpkg.Tenant(t)
		foreignCtx := testpkg.Ctx(t)
		require.NoError(t, rig.Enable(foreignCtx))
		require.NoError(t, rig.EnableRegistration(foreignCtx))
		_, foreignLead := testpkg.CreateTestStaffWithAccount(t, db, "Xaver", "Fremd")
		foreignChain := testpkg.CreateTestParentGuardianChain(t, db)
		bookMeals(t, db, foreignTenant, foreignChain.StudentID, foreignLead.ID)
		foreignToken := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(foreignChain.AccountID)))
		code, answer, body := readChildDay(t, parentToday, foreignToken, foreignChain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Empty(t, childMealLines(answer), "a booked child of another school keeps its lunch")
		code, _, body = readChildDay(t, parentToday, foreignToken, chain.StudentID)
		assert.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, code, body)
	})

	t.Run("removing the cancellation removes the entry", func(t *testing.T) {
		require.Equal(t, http.StatusNoContent, send(http.MethodDelete, "").Code)
		code, answer, body := readChildDay(t, parentToday, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Empty(t, childMealLines(answer))
	})
}

// childSourceStatus is the status of one source of the child's day.
func childSourceStatus(answer childDayWire, source string) string {
	for _, status := range answer.Sources {
		if status.Source == source {
			return status.Status
		}
	}
	return ""
}
