package presence_test

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

func TestDashboardAnalyticsPositiveGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	testpkg.SetupIsolatedTestDB(t)
	tc, router := setupProtectedRouter(t)
	created := 0
	add := func(n int) {
		for range n {
			room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Analytics Room %d", created))
			activity := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("Analytics Activity %d", created))
			group := testpkg.CreateTestActiveGroup(t, tc.db, activity.ID, room.ID)
			staff := testpkg.CreateTestStaff(t, tc.db, "Analytics", fmt.Sprintf("Staff%d", created))
			testpkg.CreateTestGroupSupervisor(t, tc.db, staff.ID, group.ID, "supervisor")
			child := testpkg.CreateTestStudent(t, tc.db, "Analytics", fmt.Sprintf("Child%d", created), "3a")
			testpkg.CreateTestVisit(t, tc.db, child.ID, group.ID, time.Now(), nil)
			created++
		}
	}
	counter := testpkg.CaptureQueries(t, tc.db)
	run := func() testpkg.QueryMeasurement {
		counter.Reset()
		rr := testutil.ExecuteWithAuthPermissions(t, testpkg.MountedQueryBudgetRouter("/api", router), testutil.NewRequest("GET", "/active/analytics/dashboard", nil), testutil.AdminTestClaims(1), []string{"admin:*"})
		queries := counter.Queries()
		require.Equal(t, testutil.StatusOK, rr.Code, rr.Body.String())
		var response struct {
			Data presenceAPI.DashboardAnalyticsResponse `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
		require.Equal(t, created, response.Data.StudentsPresent)
		require.Equal(t, created, response.Data.ActiveActivities)
		require.Equal(t, created, response.Data.SupervisorsToday)
		require.Len(t, response.Data.CurrentActivities, min(created, 5))
		return counter.Measurement(queries)
	}
	add(3)
	small := run()
	add(5)
	large := run()
	require.Equal(t, len(small.Statements), len(large.Statements), "positive N3/N8 dashboard capture")
	t.Logf("dashboard full route N3=%d N8=%d", len(small.Statements), len(large.Statements))
	querybudgets.AssertQueryBudget(t, "api.active.analytics.dashboard.positive", small)
	querybudgets.AssertQueryBudget(t, "api.active.analytics.dashboard.positive", large)
}
