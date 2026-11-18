package mealplan_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	mealplanHTTP "github.com/moto-ogs/project-phoenix/modules/mealplan/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// recordedMonths serves one Mensa month and records its release.
type recordedMonths struct{ released *mealplanModule.BillingMonthRelease }

func (m *recordedMonths) BillingMonthOverview(context.Context) ([]mealplanModule.BillingMonthSummary, error) {
	children, meals := 2, 9
	return []mealplanModule.BillingMonthSummary{{Month: "2026-08-01", Status: mealplanModule.BillingMonthOpen, ChildCount: &children, MealCount: &meals}}, nil
}

func (m *recordedMonths) month(status mealplanModule.BillingMonthStatus) mealplanModule.BillingMonth {
	return mealplanModule.BillingMonth{Month: "2026-08-01", Status: status, SchoolDays: 21, ChildCount: 2, MealCount: 9, Fingerprint: "abc",
		Children: []mealplanModule.BillingMonthChild{{StudentID: 42, FirstName: "Mia", LastName: "Muster", SchoolClass: "2a", RegisteredDays: 5, MealDays: 4, AbsentDates: []mealplanModule.Date{"2026-08-12"}}}}
}

func (m *recordedMonths) BillingMonth(context.Context, mealplanModule.Date) (mealplanModule.BillingMonth, error) {
	return m.month(mealplanModule.BillingMonthOpen), nil
}

func (m *recordedMonths) ReleaseBillingMonth(_ context.Context, release mealplanModule.BillingMonthRelease) (mealplanModule.BillingMonth, error) {
	m.released = &release
	return m.month(mealplanModule.BillingMonthReleased), nil
}

// The routes of the staff portal under their production paths, answered
// through the shared envelope (ADR 0270): a school changes a child's
// registration and regular days, reads the week list, and releases a Mensa
// month with the counts it saw.
func TestMealPlanRoutesAnswerUnderTheirProductionPaths(t *testing.T) {
	t.Parallel()
	recorded := &dayChange{}
	months := &recordedMonths{}
	runtime := mealplanHTTP.Runtime{
		Protected:  routetest.UnprotectedGroupFunc(),
		Permission: func(mealplanHTTP.Access) mealplanHTTP.Middleware { return routetest.IdentityMiddleware },
		Success:    common.Respond, InvalidRequest: routetest.RespondInvalidRequest, ParseIDParam: testpkg.ParseHTTPIDParam,
		ModuleFailure: routetest.ErrorResponder(resolveModuleFailure),
		RenderList: func(mealplanModule.ListExport, string) (mealplanHTTP.ExportFile, error) {
			return mealplanHTTP.ExportFile{}, nil
		},
		CurrentAccountID: func(context.Context) int64 { return 9 },
		Allowed:          func(context.Context, mealplanHTTP.Access) bool { return true },
	}
	router := chi.NewRouter()
	router.Mount("/api/meal-plan", mealplanHTTP.NewResource(engine{available: true, dayChange: recorded}, runtime).Router())
	router.Mount("/api/meal-billing-months", mealplanHTTP.NewBillingMonthResource(months, runtime).Router())
	send := func(method, path, body string, out any) {
		t.Helper()
		var reader *strings.Reader
		if body != "" {
			reader = strings.NewReader(body)
		}
		var request *http.Request
		if reader == nil {
			request = routetest.NewRequest(method, path, nil)
		} else {
			request = routetest.NewRequest(method, path, reader)
		}
		response := routetest.ExecuteRequest(router, request)
		require.Equal(t, http.StatusOK, response.Code, "%s %s: %s", method, path, response.Body.String())
		if out != nil {
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &struct{ Data any }{Data: out}))
		}
	}

	send(http.MethodPut, "/api/meal-plan/participation/42/days/2026-09-10", `{"participating":true}`, nil)
	assert.Equal(t, dayChange{accountID: 9, date: "2026-09-10", participating: true, bySchool: true}, *recorded)
	send(http.MethodDelete, "/api/meal-plan/participation/42/days/2026-09-10", "", nil)
	var changed struct {
		EffectiveFrom string `json:"effective_from"`
	}
	send(http.MethodPut, "/api/meal-plan/participation/42/schedule", `{"weekdays":[1,3],"effective_from":"2026-09-07"}`, &changed)
	assert.Equal(t, "2026-09-07", changed.EffectiveFrom)
	var week struct {
		WeekStart string `json:"week_start"`
		Days      []struct {
			Participants []struct {
				StudentID string `json:"student_id"`
			} `json:"participants"`
		} `json:"days"`
	}
	send(http.MethodGet, "/api/meal-plan/participants/week?week_start=2026-09-07", "", &week)
	assert.Equal(t, "2026-09-07", week.WeekStart)
	require.Len(t, week.Days, 5)
	require.Len(t, week.Days[1].Participants, 1)
	assert.Equal(t, "42", week.Days[1].Participants[0].StudentID)

	var overview []struct {
		Month  string `json:"month"`
		Status string `json:"status"`
	}
	send(http.MethodGet, "/api/meal-billing-months/", "", &overview)
	require.Len(t, overview, 1)
	assert.Equal(t, "open", overview[0].Status)
	var month struct {
		Fingerprint string `json:"fingerprint"`
		Children    []struct {
			AbsentDates []string `json:"absent_dates"`
		} `json:"children"`
	}
	send(http.MethodGet, "/api/meal-billing-months/2026-08-01", "", &month)
	assert.Equal(t, "abc", month.Fingerprint)
	assert.Equal(t, []string{"2026-08-12"}, month.Children[0].AbsentDates)
	var released struct {
		Status string `json:"status"`
	}
	send(http.MethodPost, "/api/meal-billing-months/2026-08-01/release", `{"child_count":2,"meal_count":9,"fingerprint":"abc"}`, &released)
	assert.Equal(t, "released", released.Status)
	require.NotNil(t, months.released)
	assert.Equal(t, mealplanModule.BillingMonthRelease{Month: "2026-08-01", AccountID: 9, ChildCount: 2, MealCount: 9, Fingerprint: "abc"}, *months.released)
}
