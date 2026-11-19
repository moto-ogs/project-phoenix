package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// recordedMealPlan stands in for the meal plan owner behind the school's
// registration routes; it records what the routes hand on.
type recordedMealPlan struct {
	mealplanModule.Capability
	changes  []mealplanModule.SchoolChange
	cleared  []mealplanModule.SchoolChange
	schedule *mealplanModule.SchoolSchedule
	replaced []mealplanModule.ReplaceDay
	emptied  []mealplanModule.ClearDay
}

func (m *recordedMealPlan) Week(_ context.Context, weekStart mealplanModule.Date) ([]mealplanModule.Entry, error) {
	return []mealplanModule.Entry{{Date: weekStart, Position: 1, Dish: "Linsensuppe", Allergens: []mealplanModule.Allergen{"A"}}}, nil
}

func (m *recordedMealPlan) ReplaceDay(_ context.Context, day mealplanModule.ReplaceDay) error {
	m.replaced = append(m.replaced, day)
	return nil
}

func (m *recordedMealPlan) ClearDay(_ context.Context, day mealplanModule.ClearDay) error {
	m.emptied = append(m.emptied, day)
	return nil
}

func (m *recordedMealPlan) SetParticipationBySchool(_ context.Context, change mealplanModule.SchoolChange) error {
	m.changes = append(m.changes, change)
	return nil
}

func (m *recordedMealPlan) ClearParticipationBySchool(_ context.Context, change mealplanModule.SchoolChange) error {
	m.cleared = append(m.cleared, change)
	return nil
}

func (m *recordedMealPlan) ReplaceScheduleBySchool(_ context.Context, schedule mealplanModule.SchoolSchedule) (mealplanModule.Date, error) {
	m.schedule = &schedule
	return schedule.EffectiveFrom, nil
}

func (m *recordedMealPlan) WeeklyList(_ context.Context, weekStart mealplanModule.Date) (mealplanModule.WeeklyList, error) {
	return mealplanModule.WeeklyList{WeekStart: weekStart, Days: []mealplanModule.DailyList{{
		Date: weekStart, CutoffTime: "09:00",
		Participants: []mealplanModule.DailyParticipant{{StudentID: 42, FirstName: "Mia", LastName: "Muster", SchoolClass: "2a"}},
	}}}, nil
}

// recordedBillingMonths serves one Mensa month and records its release.
type recordedBillingMonths struct {
	released *mealplanModule.BillingMonthRelease
}

func (m *recordedBillingMonths) month(status mealplanModule.BillingMonthStatus) mealplanModule.BillingMonth {
	return mealplanModule.BillingMonth{Month: "2026-08-01", Status: status, SchoolDays: 21, ChildCount: 1, MealCount: 4, Fingerprint: "abc",
		Children: []mealplanModule.BillingMonthChild{{StudentID: 42, FirstName: "Mia", LastName: "Muster", SchoolClass: "2a", RegisteredDays: 5, MealDays: 4, AbsentDates: []mealplanModule.Date{"2026-08-12"}}}}
}

func (m *recordedBillingMonths) BillingMonthOverview(context.Context) ([]mealplanModule.BillingMonthSummary, error) {
	children, meals := 1, 4
	return []mealplanModule.BillingMonthSummary{{Month: "2026-08-01", Status: mealplanModule.BillingMonthOpen, ChildCount: &children, MealCount: &meals}}, nil
}

func (m *recordedBillingMonths) BillingMonth(context.Context, mealplanModule.Date) (mealplanModule.BillingMonth, error) {
	month := m.month(mealplanModule.BillingMonthOpen)
	current := m.month(mealplanModule.BillingMonthOpen)
	month.Current = &current
	return month, nil
}

func (m *recordedBillingMonths) ReleaseBillingMonth(_ context.Context, release mealplanModule.BillingMonthRelease) (mealplanModule.BillingMonth, error) {
	m.released = &release
	return m.month(mealplanModule.BillingMonthReleased), nil
}

// A school changes a child's meal registration and regular days, reads the
// week list, and releases a Mensa month with the counts it saw: the
// production resources under /api, with the server's session, permission and
// transaction chains, hand each request on to the owner.
func TestMealPlanSchoolRoutesHandTheirRequestsOn(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	plan, months := &recordedMealPlan{}, &recordedBillingMonths{}
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/meal-plan", newMealPlanResource(plan, NewSimpleListRenderer()).Router())
	router.Mount("/api/meal-billing-months", newMealBillingMonthResource(months).Router())
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Mensa", "Leitung")
	claims := testutil.TenantUserTestClaims(int(account.ID), testpkg.Tenant(t), "admin:*")
	bearer := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	send := func(method, path string, body, out any) {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, bearer))
		require.Equal(t, http.StatusOK, response.Code, "%s %s: %s", method, path, response.Body.String())
		if out != nil {
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &struct{ Data any }{Data: out}))
		}
	}

	send(http.MethodPut, "/api/meal-plan/participation/42/days/2026-09-10", map[string]any{"participating": true}, nil)
	send(http.MethodDelete, "/api/meal-plan/participation/42/days/2026-09-10", nil, nil)
	require.Len(t, plan.changes, 1)
	assert.Equal(t, mealplanModule.SchoolChange{StudentID: 42, StaffAccountID: account.ID, Date: "2026-09-10", Participating: true}, plan.changes[0])
	require.Len(t, plan.cleared, 1)
	var changed struct {
		EffectiveFrom string `json:"effective_from"`
	}
	send(http.MethodPut, "/api/meal-plan/participation/42/schedule", map[string]any{"weekdays": []int{1, 3}, "effective_from": "2026-09-07"}, &changed)
	assert.Equal(t, "2026-09-07", changed.EffectiveFrom)
	require.NotNil(t, plan.schedule)
	assert.Equal(t, []mealplanModule.Weekday{1, 3}, plan.schedule.Weekdays)
	var week struct {
		WeekStart string `json:"week_start"`
		Days      []struct {
			Participants []struct {
				StudentID string `json:"student_id"`
			} `json:"participants"`
		} `json:"days"`
	}
	send(http.MethodGet, "/api/meal-plan/participants/week?week_start=2026-09-07", nil, &week)

	var dishes []struct {
		Date      string   `json:"date"`
		Dish      string   `json:"dish"`
		Allergens []string `json:"allergens"`
	}
	send(http.MethodGet, "/api/meal-plan/?week_start=2026-09-07", nil, &dishes)
	require.Len(t, dishes, 1)
	assert.Equal(t, "Linsensuppe", dishes[0].Dish)
	assert.Equal(t, []string{"A"}, dishes[0].Allergens)
	send(http.MethodPut, "/api/meal-plan/2026-09-08", map[string]any{"dishes": []map[string]any{{"dish": "Nudeln", "note": nil}}}, nil)
	require.Len(t, plan.replaced, 1)
	assert.Equal(t, mealplanModule.Date("2026-09-08"), plan.replaced[0].Date)
	assert.Equal(t, "Nudeln", plan.replaced[0].Dishes[0].Dish)
	send(http.MethodDelete, "/api/meal-plan/2026-09-08", nil, nil)
	require.Len(t, plan.emptied, 1)
	assert.Equal(t, account.ID, plan.emptied[0].AccountID)
	assert.Equal(t, "2026-09-07", week.WeekStart)
	require.Len(t, week.Days, 1)
	assert.Equal(t, "42", week.Days[0].Participants[0].StudentID)

	var overview []struct {
		Status string `json:"status"`
	}
	send(http.MethodGet, "/api/meal-billing-months/", nil, &overview)
	require.Len(t, overview, 1)
	assert.Equal(t, "open", overview[0].Status)
	var month struct {
		Fingerprint string `json:"fingerprint"`
		Current     *struct {
			Month string `json:"month"`
		} `json:"current"`
	}
	send(http.MethodGet, "/api/meal-billing-months/2026-08-01", nil, &month)
	assert.Equal(t, "abc", month.Fingerprint)
	require.NotNil(t, month.Current, "the month as computed now travels beside the release")
	assert.Equal(t, "2026-08-01", month.Current.Month)
	var released struct {
		Status string `json:"status"`
	}
	send(http.MethodPost, "/api/meal-billing-months/2026-08-01/release", map[string]any{"child_count": 1, "meal_count": 4, "fingerprint": "abc"}, &released)
	assert.Equal(t, "released", released.Status)
	require.NotNil(t, months.released)
	assert.Equal(t, mealplanModule.BillingMonthRelease{Month: "2026-08-01", AccountID: account.ID, ChildCount: 1, MealCount: 4, Fingerprint: "abc"}, *months.released)
}
