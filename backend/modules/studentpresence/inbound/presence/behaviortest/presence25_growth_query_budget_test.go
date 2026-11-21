package presence_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

// These requests use the registered resource and its protected tenant chain,
// mounted at the production prefix. All fixture writes precede capture resets.
func TestPresence25VisitGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	for _, route := range []struct{ name, path string }{
		{"list", "/api/active/visits/"},
	} {
		t.Run(route.name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			testpkg.SetupIsolatedTestDB(t)
			tc, active := setupProtectedRouter(t)
			router := testutil.NewRouter()
			router.Mount("/api", active)
			room := testpkg.CreateTestRoom(t, tc.db, "Presence25Room")
			activity := testpkg.CreateTestActivityGroup(t, tc.db, "Presence25Activity")
			group := testpkg.CreateTestActiveGroup(t, tc.db, activity.ID, room.ID)
			path := route.path
			counter := testpkg.CaptureQueriesForContext(t, tc.db)
			expected := make([]presenceAPI.VisitResponse, 0, 8)
			for _, n := range []int{3, 8} {
				for len(expected) < n {
					childID := testpkg.CreateTestStudent(t, tc.db, "Presence25", fmt.Sprintf("Child%d", len(expected)), "P25").ID
					visit := testpkg.CreateTestVisit(t, tc.db, childID, group.ID, time.Date(2026, 11, 5, 9, len(expected), 0, 0, time.UTC), nil)
					expected = append(expected, presenceAPI.VisitResponse{ID: ident.ID(visit.ID), StudentID: ident.ID(childID), ActiveGroupID: ident.ID(group.ID), CheckInTime: visit.EntryTime, IsActive: true, CreatedAt: visit.CreatedAt, UpdatedAt: visit.UpdatedAt})
				}
				counter.Reset()
				req := testutil.NewRequest(http.MethodGet, path, nil)
				req = req.WithContext(counter.Context(req.Context()))
				rr := testutil.ExecuteWithAuthPermissions(t, router, req, testutil.AdminTestClaims(1), []string{"admin:*"})
				require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
				var result struct {
					Data []presenceAPI.VisitResponse `json:"data"`
				}
				require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &result))
				require.Len(t, result.Data, n)
				// Compare every serialized visit field, not just IDs or success status.
				for i := range result.Data {
					result.Data[i].CheckInTime = result.Data[i].CheckInTime.UTC()
					result.Data[i].CreatedAt = result.Data[i].CreatedAt.UTC()
					result.Data[i].UpdatedAt = result.Data[i].UpdatedAt.UTC()
				}
				for i := range expected {
					expected[i].CreatedAt = expected[i].CreatedAt.UTC()
					expected[i].UpdatedAt = expected[i].UpdatedAt.UTC()
				}
				require.ElementsMatch(t, expected, result.Data)
				t.Logf("presence25 %s N%d: %d full-route statements", path, n, counter.Total())
				assertPresence25VisitBudget(t, route.name, n, counter.Measurement(counter.Queries()))
			}
		})
	}
}

func assertPresence25VisitBudget(t *testing.T, route string, n int, queries querybudgets.Measurement) {
	t.Helper()
	switch fmt.Sprintf("%s.n%d", route, n) {
	case "list.n3":
		querybudgets.AssertQueryBudget(t, "api.active.presence25.list.n3", queries)
	case "list.n8":
		querybudgets.AssertQueryBudget(t, "api.active.presence25.list.n8", queries)
	default:
		t.Fatalf("unregistered presence25 fixture %s N%d", route, n)
	}
}
