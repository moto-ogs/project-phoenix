package httpadapter_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The room routes the staff portal reaches through its catalog proxy (#7563)
// answer within their registered contract under the full /api/rooms pattern.
// The proxy checks every answer and turns a deviation into a 502.
func TestRoomRoutesAnswerTheirContract(t *testing.T) {
	t.Parallel()
	tc := setupRoomsRoute(t)
	router := testpkg.MountedQueryBudgetRouter("/api/rooms", tc.router)
	claims := testutil.AdminTestClaims(1)
	ctx := testpkg.Ctx(t)
	require.NoError(t, tc.services.Settings.SetValue(ctx, settingAttendanceLogEnabled, true, nil, nil))
	room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Contract Room %d", testpkg.Tenant(t)))
	exec := func(method, path string, body any) (int, string) {
		t.Helper()
		request := testutil.NewRequest(method, path, nil)
		if body != nil {
			request = testutil.NewJSONRequest(t, method, path, body)
		}
		rr := testutil.ExecuteWithAuth(t, router, request, claims)
		return rr.Code, rr.Body.String()
	}

	code, body := exec(http.MethodGet, "/?page=1&page_size=10&include_system=true", nil)
	require.Equal(t, http.StatusOK, code, body)
	assert.Contains(t, body, `"pagination"`)

	code, body = exec(http.MethodPost, "/", map[string]any{"name": "Vertragsraum", "capacity": 12})
	require.Equal(t, http.StatusCreated, code, body)

	code, body = exec(http.MethodGet, fmt.Sprintf("/%d", room.ID), nil)
	require.Equal(t, http.StatusOK, code, body)

	code, body = exec(http.MethodPut, fmt.Sprintf("/%d", room.ID), map[string]any{"name": "Vertragsraum neu"})
	require.Equal(t, http.StatusOK, code, body)

	// A room without sessions answers an empty list, never null: the
	// contract names an array.
	code, body = exec(http.MethodGet, fmt.Sprintf("/%d/history", room.ID), nil)
	require.Equal(t, http.StatusOK, code, body)
	assert.Contains(t, body, `"data":[]`)

	code, body = exec(http.MethodDelete, fmt.Sprintf("/%d", room.ID), nil)
	require.Equal(t, http.StatusOK, code, body)
	assert.Contains(t, body, `"outcome":"delete"`)
}

// The room form's checks hold in the backend, not only in the BFF route file
// that #7563 retires: a name of blanks and a capacity below one are refused
// on create and on update.
func TestRoomWritesRefuseBlankNameAndCapacityBelowOne(t *testing.T) {
	t.Parallel()
	tc := setupRoomsRoute(t)
	router := testpkg.MountedQueryBudgetRouter("/api/rooms", tc.router)
	claims := testutil.AdminTestClaims(1)
	room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Checked Room %d", testpkg.Tenant(t)))
	for _, tt := range []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{"create with a blank name", http.MethodPost, "/", map[string]any{"name": "   "}},
		{"create with capacity zero", http.MethodPost, "/", map[string]any{"name": "Raum Null", "capacity": 0}},
		{"update with a blank name", http.MethodPut, fmt.Sprintf("/%d", room.ID), map[string]any{"name": " \t "}},
		{"update with a negative capacity", http.MethodPut, fmt.Sprintf("/%d", room.ID), map[string]any{"name": "Raum", "capacity": -3}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rr := testutil.ExecuteWithAuth(t, router, testutil.NewJSONRequest(t, tt.method, tt.path, tt.body), claims)
			testutil.AssertBadRequest(t, rr)
		})
	}
}
