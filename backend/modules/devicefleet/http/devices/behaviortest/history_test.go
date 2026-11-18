package devices_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type historyChange struct {
	Before *string `json:"before"`
	After  *string `json:"after"`
}

type historyEntry struct {
	ID         string                   `json:"id"`
	Action     string                   `json:"action"`
	ActorKind  string                   `json:"actor_kind"`
	ActorName  *string                  `json:"actor_name"`
	Changes    map[string]historyChange `json:"changes"`
	OccurredAt string                   `json:"occurred_at"`
}

func value(text string) *string { return &text }

// TestDeviceHistoryRecordsEveryLifecycleChange walks one device through its
// school lifecycle and reads the history (#2321): every effective change
// names the acting staff member and the values before and after; an edit
// without a material change and a repeated block record nothing; no
// credential reaches the history.
func TestDeviceHistoryRecordsEveryLifecycleChange(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)
	account := testpkg.CreateTestAccount(t, ctx.db, fmt.Sprintf("history-%d@example.com", testpkg.Tenant(t)))
	person := testpkg.CreateTestPerson(t, ctx.db, "Maria", "Muster")
	_, err := ctx.db.NewRaw(`UPDATE users.persons SET account_id = ? WHERE id = ?`, account.ID, person.ID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	claims := testutil.DefaultTestClaims()
	// The history names the person behind the account, not the token's name.
	claims.ID, claims.FirstName, claims.LastName = int(account.ID), "Token", "Name"
	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())
	request := func(method, path string, body any) *testutilResponse {
		req := testutil.NewAuthenticatedRequest(t, method, path, body,
			testutil.WithClaims(t, claims), testutil.WithPermissions("iot:read", "iot:update", "iot:manage"))
		rr := testutil.ExecuteRequest(router, req)
		return &testutilResponse{status: rr.Code, body: rr.Body.Bytes()}
	}

	hardwareID := fmt.Sprintf("history-%d", testpkg.Tenant(t))
	created := request(http.MethodPost, "/devices", map[string]any{"device_id": hardwareID, "device_type": "rfid_reader", "name": "Eingang"})
	require.Equal(t, http.StatusCreated, created.status, string(created.body))
	var device struct {
		ID     int64  `json:"id"`
		APIKey string `json:"api_key"`
	}
	created.data(t, &device)
	require.NotEmpty(t, device.APIKey)

	edit := map[string]any{"device_id": hardwareID, "device_type": "rfid_reader", "name": "Haupteingang"}
	require.Equal(t, http.StatusOK, request(http.MethodPut, fmt.Sprintf("/devices/%d", device.ID), edit).status)
	require.Equal(t, http.StatusOK, request(http.MethodPut, fmt.Sprintf("/devices/%d", device.ID), edit).status, "an unchanged edit")
	statusPath := "/devices/" + url.PathEscape(hardwareID) + "/status"
	require.Equal(t, http.StatusOK, request(http.MethodPatch, statusPath, map[string]any{"status": "inactive"}).status)
	require.Equal(t, http.StatusOK, request(http.MethodPatch, statusPath, map[string]any{"status": "inactive"}).status, "a repeated block")
	require.Equal(t, http.StatusOK, request(http.MethodPatch, statusPath, map[string]any{"status": "active"}).status)
	require.Equal(t, http.StatusOK, request(http.MethodDelete, fmt.Sprintf("/devices/%d", device.ID), nil).status)

	history := request(http.MethodGet, fmt.Sprintf("/devices/%d/history", device.ID), nil)
	require.Equal(t, http.StatusOK, history.status, string(history.body))
	assert.NotContains(t, string(history.body), device.APIKey)
	assert.NotContains(t, string(history.body), "api_key")
	var entries []historyEntry
	history.data(t, &entries)

	actions := make([]string, 0, len(entries))
	for _, entry := range entries {
		actions = append(actions, entry.Action)
		assert.Equal(t, "school_staff", entry.ActorKind)
		require.NotNil(t, entry.ActorName)
		assert.Equal(t, "Maria Muster", *entry.ActorName)
		assert.NotEmpty(t, entry.OccurredAt)
	}
	require.Equal(t, []string{"removed", "unblocked", "blocked", "updated", "created"}, actions)
	assert.Equal(t, map[string]historyChange{"status": {Before: value("inactive"), After: value("active")}}, entries[1].Changes)
	assert.Equal(t, map[string]historyChange{"status": {Before: value("active"), After: value("inactive")}}, entries[2].Changes)
	assert.Equal(t, map[string]historyChange{"name": {Before: value("Eingang"), After: value("Haupteingang")}}, entries[3].Changes)
	assert.Equal(t, map[string]historyChange{
		"device_id":   {After: value(hardwareID)},
		"device_type": {After: value("rfid_reader")},
		"name":        {After: value("Eingang")},
		"status":      {After: value("active")},
	}, entries[4].Changes)
}

// TestDeviceHistoryStaysWithinTheSchool reads another school's device: it
// is not found, and a device nobody changed has an empty history.
func TestDeviceHistoryStaysWithinTheSchool(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)
	device := testpkg.CreateTestDevice(t, ctx.db, fmt.Sprintf("history-never-%d", testpkg.Tenant(t)))
	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())
	read := func(tenantID int64) *testutilResponse {
		claims := testutil.DefaultTestClaims()
		if tenantID != 0 {
			claims.TenantID = tenantID
		}
		req := testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/devices/%d/history", device.ID), nil,
			testutil.WithClaims(t, claims), testutil.WithPermissions("iot:read"))
		rr := testutil.ExecuteRequest(router, req)
		return &testutilResponse{status: rr.Code, body: rr.Body.Bytes()}
	}

	own := read(0)
	require.Equal(t, http.StatusOK, own.status, string(own.body))
	var entries []historyEntry
	own.data(t, &entries)
	assert.Empty(t, entries, "a device nobody changed has no history")

	foreign := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, ctx.db, foreign)
	other := read(foreign)
	assert.Equal(t, http.StatusNotFound, other.status, string(other.body))
}

type testutilResponse struct {
	status int
	body   []byte
}

func (r *testutilResponse) data(t *testing.T, target any) {
	t.Helper()
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(r.body, &envelope), string(r.body))
	require.NoError(t, json.Unmarshal(envelope.Data, target), string(envelope.Data))
}

// TestDeviceHistoryEditRacingARemovalRecordsNothing pins the row lock of a
// school edit (#2321): a removal holds the device row while the edit
// arrives. The edit waits for the lock, finds the device removed and answers
// 404. Read without the lock, the edit's history entry came from the
// snapshot before the removal and committed although nothing changed.
func TestDeviceHistoryEditRacingARemovalRecordsNothing(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)
	hardwareID := fmt.Sprintf("history-race-%d", testpkg.Tenant(t))
	device := testpkg.CreateTestDevice(t, ctx.db, hardwareID)
	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	removal, err := ctx.db.BeginTx(testpkg.Ctx(t), nil)
	require.NoError(t, err)
	defer func() { _ = removal.Rollback() }()
	_, err = removal.ExecContext(testpkg.Ctx(t), `UPDATE iot.devices SET archived_at = NOW() WHERE id = ?`, device.ID)
	require.NoError(t, err)
	var removalPID int
	require.NoError(t, removal.QueryRowContext(testpkg.Ctx(t), `SELECT pg_backend_pid()`).Scan(&removalPID))

	done := make(chan int, 1)
	go func() {
		req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/devices/%d", device.ID),
			map[string]any{"device_id": hardwareID, "device_type": "terminal", "name": "Nach dem Entfernen"},
			testutil.WithClaims(t, testutil.DefaultTestClaims()), testutil.WithPermissions("iot:update"))
		done <- testutil.ExecuteRequest(router, req).Code
	}()
	require.Eventually(t, func() bool {
		var waiting int
		err := ctx.db.NewRaw(`SELECT COUNT(*) FROM pg_stat_activity
			WHERE ? = ANY(pg_blocking_pids(pid))`, removalPID).Scan(testpkg.Ctx(t), &waiting)
		return err == nil && waiting > 0
	}, 20*time.Second, 20*time.Millisecond, "the edit never waited on the device row")
	require.NoError(t, removal.Commit())

	assert.Equal(t, http.StatusNotFound, <-done)
	var entries int
	require.NoError(t, ctx.db.NewRaw(`SELECT COUNT(*) FROM audit.device_lifecycle_events WHERE device_id = ?`, device.ID).Scan(testpkg.Ctx(t), &entries))
	assert.Zero(t, entries, "an edit that changed nothing records nothing")
}
