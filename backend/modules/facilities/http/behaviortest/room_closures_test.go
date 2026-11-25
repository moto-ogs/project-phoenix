//go:build testhooks

package httpadapter_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	httpadapter "github.com/moto-ogs/project-phoenix/modules/facilities/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// roomClosuresToday is the school day the closure routes run on.
var roomClosuresToday = time.Date(2026, time.November, 25, 9, 0, 0, 0, time.UTC)

func setupRoomClosuresRoute(t *testing.T) *testContext {
	t.Helper()
	return setupRoomsRouteWith(t, func(dependencies *httpadapter.Dependencies) {
		db := testpkg.SetupTestDB(t)
		closures, err := facilitiesCompose.NewClosures(facilitiesCompose.Dependencies{
			DB: db, Observe: func(facilitiesCompose.Observation) {}, Now: func() time.Time { return roomClosuresToday },
		})
		require.NoError(t, err)
		dependencies.Closures = closures
	})
}

type roomClosureCall struct {
	router      chi.Router
	claims      testutil.Claims
	permissions []string
}

func (c roomClosureCall) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		require.NoError(t, err)
	}
	req := testutil.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	return testutil.ExecuteWithAuthPermissions(t, c.router, req, c.claims, c.permissions)
}

func (c roomClosureCall) list(t *testing.T, query string) []httpadapter.RoomClosureResponse {
	t.Helper()
	rr := c.do(t, http.MethodGet, "/closures?"+query, nil)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body struct {
		Data []httpadapter.RoomClosureResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	return body.Data
}

func closureBody(start, end, reason string) map[string]string {
	return map[string]string{"start_date": start, "end_date": end, "reason": reason}
}

// TestRoomClosures_PermissionTenantAndLifecycle closes a room, reads and
// lifts the closure, and pins every boundary of the routes (#7653): reading
// needs rooms:read, closing and lifting need rooms:update, and no school
// sees, closes or lifts another school's room or closure.
func TestRoomClosures_PermissionTenantAndLifecycle(t *testing.T) {
	t.Parallel()
	tc := setupRoomClosuresRoute(t)
	tenantID := newRoomFilterTestTenant(t, tc.db)
	foreignTenantID := newRoomFilterTestTenant(t, tc.db)
	room := testpkg.CreateTestRoomForTenant(t, tc.db, tenantID, "Gesperrter Werkraum")
	foreignRoom := testpkg.CreateTestRoomForTenant(t, tc.db, foreignTenantID, "Fremder Werkraum")

	reader := roomClosureCall{router: tc.router, claims: testutil.AdminTestClaimsForTenant(1, tenantID), permissions: []string{"rooms:read"}}
	keeper := reader
	keeper.permissions = []string{"rooms:read", "rooms:update"}
	foreignKeeper := keeper
	foreignKeeper.claims = testutil.AdminTestClaimsForTenant(1, foreignTenantID)
	closuresPath := fmt.Sprintf("/%d/closures", room.ID)

	t.Run("rooms:read alone closes no room", func(t *testing.T) {
		rr := reader.do(t, http.MethodPost, closuresPath, closureBody("2026-11-30", "2026-12-02", "Wasserschaden"))
		assert.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
		assert.Empty(t, reader.list(t, "from=2026-11-25&to=2026-12-31"))
	})

	t.Run("an invalid closure is refused", func(t *testing.T) {
		for name, body := range map[string]map[string]string{
			"end before start":    closureBody("2026-12-02", "2026-11-30", "Wasserschaden"),
			"ended before today":  closureBody("2026-11-20", "2026-11-24", "Wasserschaden"),
			"without reason":      closureBody("2026-11-30", "2026-11-30", "   "),
			"longer than a year":  closureBody("2026-11-30", "2027-12-01", "Umbau"),
			"date without format": closureBody("30.11.2026", "2026-11-30", "Wasserschaden"),
		} {
			rr := keeper.do(t, http.MethodPost, closuresPath, body)
			assert.Equal(t, http.StatusBadRequest, rr.Code, "%s: %s", name, rr.Body.String())
		}
	})

	var closure httpadapter.RoomClosureResponse
	t.Run("rooms:update closes the room for its period", func(t *testing.T) {
		rr := keeper.do(t, http.MethodPost, closuresPath, closureBody("2026-11-30", "2026-12-02", "  Wasserschaden  "))
		require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
		var body struct {
			Data httpadapter.RoomClosureResponse `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
		closure = body.Data
		assert.Equal(t, room.ID, closure.RoomID.Int64())
		assert.Equal(t, "2026-11-30", closure.StartDate.String())
		assert.Equal(t, "2026-12-02", closure.EndDate.String())
		assert.Equal(t, "Wasserschaden", closure.Reason)
	})

	t.Run("staff with rooms:read see the closure on its days only", func(t *testing.T) {
		listed := reader.list(t, "from=2026-12-02&to=2026-12-02")
		require.Len(t, listed, 1)
		assert.Equal(t, closure.ID, listed[0].ID)
		assert.Len(t, reader.list(t, fmt.Sprintf("from=2026-11-25&to=2026-12-31&room_id=%d", room.ID)), 1)
		assert.Empty(t, reader.list(t, "from=2026-12-03&to=2026-12-10"), "the day after the period")
		assert.Empty(t, reader.list(t, "from=2026-11-25&to=2026-11-29"), "the days before it")
	})

	t.Run("another school neither sees, closes nor lifts it", func(t *testing.T) {
		assert.Empty(t, foreignKeeper.list(t, "from=2026-11-25&to=2026-12-31"))
		rr := foreignKeeper.do(t, http.MethodPost, closuresPath, closureBody("2026-11-30", "2026-11-30", "Fremd"))
		assert.Equal(t, http.StatusNotFound, rr.Code, "another school's room: %s", rr.Body.String())
		rr = foreignKeeper.do(t, http.MethodDelete, fmt.Sprintf("%s/%d", closuresPath, closure.ID), nil)
		assert.Equal(t, http.StatusNotFound, rr.Code, rr.Body.String())
		rr = keeper.do(t, http.MethodPost, fmt.Sprintf("/%d/closures", foreignRoom.ID), closureBody("2026-11-30", "2026-11-30", "Fremd"))
		assert.Equal(t, http.StatusNotFound, rr.Code, "the own school cannot close a foreign room: %s", rr.Body.String())
		assert.Len(t, reader.list(t, "from=2026-11-30&to=2026-11-30"), 1, "the closure stands")
	})

	t.Run("rooms:read alone lifts no closure", func(t *testing.T) {
		rr := reader.do(t, http.MethodDelete, fmt.Sprintf("%s/%d", closuresPath, closure.ID), nil)
		assert.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
	})

	t.Run("rooms:update lifts it, and it is gone", func(t *testing.T) {
		rr := keeper.do(t, http.MethodDelete, fmt.Sprintf("%s/%d", closuresPath, closure.ID), nil)
		require.Equal(t, http.StatusNoContent, rr.Code, rr.Body.String())
		assert.Empty(t, reader.list(t, "from=2026-11-25&to=2026-12-31"))
		rr = keeper.do(t, http.MethodDelete, fmt.Sprintf("%s/%d", closuresPath, closure.ID), nil)
		assert.Equal(t, http.StatusNotFound, rr.Code, rr.Body.String())
		assert.Contains(t, rr.Body.String(), "rooms.closure_not_found")
	})
}

// TestRoomClosuresListQueryBudget reads the closures of the pickers' day in
// one statement, whatever the number of closed rooms.
func TestRoomClosuresListQueryBudget(t *testing.T) {
	t.Parallel()
	tc := setupRoomClosuresRoute(t)
	db := tc.db
	tenantID := newRoomFilterTestTenant(t, db)
	keeper := roomClosureCall{router: tc.router, claims: testutil.AdminTestClaimsForTenant(1, tenantID), permissions: []string{"rooms:read", "rooms:update"}}
	closeRooms := func(count int) {
		t.Helper()
		for i := range count {
			room := testpkg.CreateTestRoomForTenant(t, db, tenantID, fmt.Sprintf("Budget-Raum %d-%d", count, i))
			rr := keeper.do(t, http.MethodPost, fmt.Sprintf("/%d/closures", room.ID), closureBody("2026-11-26", "2026-11-27", "Reinigung"))
			require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
		}
	}
	counter := testpkg.CaptureQueriesForContext(t, db)
	measure := func(want int) testpkg.QueryMeasurement {
		t.Helper()
		counter.Reset()
		req := testutil.NewRequest(http.MethodGet, "/closures?from=2026-11-26&to=2026-11-26", nil)
		req = req.WithContext(counter.Context(req.Context()))
		rr := testutil.ExecuteWithAuthPermissions(t, testpkg.MountedQueryBudgetRouter("/api/rooms", tc.router), req, keeper.claims, []string{"rooms:read"})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		var body struct {
			Data []httpadapter.RoomClosureResponse `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
		require.Len(t, body.Data, want)
		for _, operation := range []string{"INSERT", "UPDATE", "DELETE", "MERGE"} {
			require.Empty(t, counter.Operation(operation), "the closure read must not issue %s", operation)
		}
		return counter.Measurement(counter.Queries())
	}
	closeRooms(3)
	small := measure(3)
	closeRooms(5)
	large := measure(8)
	require.Len(t, large.Statements, len(small.Statements), "the read grows with the closures")
	querybudgets.AssertQueryBudget(t, "api.rooms.closures.list", small)
}
