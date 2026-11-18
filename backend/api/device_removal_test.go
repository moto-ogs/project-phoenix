//go:build testhooks

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// deviceRemovalFixture is the school device route over the real Device Fleet
// and Student Presence owners, with the removal audit captured.
type deviceRemovalFixture struct {
	db     *bun.DB
	fleet  devicefleet.Capability
	router chi.Router
	audit  *bytes.Buffer
}

func newDeviceRemovalFixture(t *testing.T) deviceRemovalFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	devices, err := NewDeviceTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	presence := owners.NewUnloggedStudentPresence(testpkg.NewDatabase(t, db))
	audit := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(audit, nil))
	router := testutil.NewTenantRouter(db)
	router.Use(SecurityPrincipalMiddleware)
	router.Route("/devices", func(r chi.Router) {
		NewIoTAdministration(devicefleet.NewAdministration(devices.IoT.Fleet(), time.Now), presence, logger, time.Now)(r, func(next http.Handler) http.Handler { return next })
	})
	return deviceRemovalFixture{db: db, fleet: devices.IoT.Fleet(), router: router, audit: audit}
}

func (f deviceRemovalFixture) remove(t *testing.T, id int64) *httptest.ResponseRecorder {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/devices/%d", id), nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("iot:manage"),
	)
	return testutil.ExecuteRequest(f.router, req)
}

// storedDevice reads the row as stored, archived or not.
type storedDevice struct {
	ArchivedAt   *time.Time `bun:"archived_at"`
	Status       string     `bun:"status"`
	APIKeyHash   *string    `bun:"api_key_hash"`
	MaskedAPIKey string     `bun:"masked_api_key"`
	RoomID       *int64     `bun:"room_id"`
	DeviceID     string     `bun:"device_id"`
}

func (f deviceRemovalFixture) stored(t *testing.T, id int64) storedDevice {
	t.Helper()
	var row storedDevice
	require.NoError(t, f.db.NewSelect().TableExpr("iot.devices").
		Column("archived_at", "status", "api_key_hash", "masked_api_key", "room_id", "device_id").
		Where("id = ?", id).Scan(context.Background(), &row))
	return row
}

// startDeviceSession opens a kiosk session the device runs.
func (f deviceRemovalFixture) startDeviceSession(t *testing.T, deviceRowID int64, ended bool) int64 {
	t.Helper()
	room := testpkg.CreateTestRoom(t, f.db, "Removal room")
	activity := testpkg.CreateTestActivityGroup(t, f.db, "Removal activity")
	session := testpkg.CreateTestActiveGroup(t, f.db, activity.ID, room.ID)
	update := f.db.NewUpdate().TableExpr("active.groups").Set("device_id = ?", deviceRowID).Where("id = ?", session.ID)
	if ended {
		update = update.Set("end_time = start_time + interval '1 hour'")
	}
	_, err := update.Exec(context.Background())
	require.NoError(t, err)
	return session.ID
}

func (f deviceRemovalFixture) liveDevicesOfTenant(t *testing.T, tenantID int64) int {
	t.Helper()
	counts, err := f.fleet.CountDevicesByTenant(testpkg.Ctx(t))
	require.NoError(t, err)
	return counts[tenantID]
}

func auditEntries(t *testing.T, buffer *bytes.Buffer) []map[string]any {
	t.Helper()
	var entries []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		if line == "" {
			continue
		}
		var entry map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &entry))
		if entry["audit"] == "device_removal" {
			entries = append(entries, entry)
		}
	}
	return entries
}

func TestDeviceRemovalRejectsActiveSessionAndLeavesItUntouched(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "removal-active")
	sessionID := f.startDeviceSession(t, device.ID, false)

	rr := f.remove(t, device.ID)

	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	body := testutil.ParseJSONResponse(t, rr.Body.Bytes())
	assert.Equal(t, "iot.device_in_active_session", body["code"])
	details, ok := body["details"].(map[string]any)
	require.True(t, ok, rr.Body.String())
	assert.Equal(t, fmt.Sprint(sessionID), details["session_id"])
	assert.NotEmpty(t, details["started_at"])

	stored := f.stored(t, device.ID)
	assert.Nil(t, stored.ArchivedAt, "a protected device stays live")
	assert.Equal(t, devicefleet.DeviceStatusActive, devicefleet.DeviceStatus(stored.Status))
	assert.NotNil(t, stored.APIKeyHash, "a protected device keeps its access")
	var endTime *time.Time
	require.NoError(t, f.db.NewSelect().TableExpr("active.groups").Column("end_time").Where("id = ?", sessionID).Scan(context.Background(), &endTime))
	assert.Nil(t, endTime, "the rejected removal must not end the session")

	entries := auditEntries(t, f.audit)
	require.Len(t, entries, 1)
	assert.Equal(t, "rejected_active_session", entries[0]["outcome"])
	assert.EqualValues(t, sessionID, entries[0]["session_id"])
}

func TestDeviceRemovalArchivesKeepsHistoryAndReleasesOneSlot(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "removal-history")
	room := testpkg.CreateTestRoom(t, f.db, "Removal device room")
	_, err := f.db.NewUpdate().TableExpr("iot.devices").Set("room_id = ?", room.ID).Where("id = ?", device.ID).Exec(context.Background())
	require.NoError(t, err)
	endedSession := f.startDeviceSession(t, device.ID, true)
	tenantID := device.TenantID
	before := f.liveDevicesOfTenant(t, tenantID)

	rr := f.remove(t, device.ID)

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	stored := f.stored(t, device.ID)
	require.NotNil(t, stored.ArchivedAt, "removal archives the row instead of deleting it")
	assert.Equal(t, devicefleet.DeviceStatusInactive, devicefleet.DeviceStatus(stored.Status))
	assert.Nil(t, stored.APIKeyHash, "removal revokes the credential")
	assert.Empty(t, stored.MaskedAPIKey)
	assert.Nil(t, stored.RoomID)
	assert.Equal(t, device.DeviceID, stored.DeviceID, "the device identity stays for history")

	var historyDevice *int64
	require.NoError(t, f.db.NewSelect().TableExpr("active.groups").Column("device_id").Where("id = ?", endedSession).Scan(context.Background(), &historyDevice))
	require.NotNil(t, historyDevice)
	assert.Equal(t, device.ID, *historyDevice, "the ended session still names the device")

	assert.Equal(t, before-1, f.liveDevicesOfTenant(t, tenantID), "exactly one Geräteplatz is released")
	_, err = f.fleet.FindDeviceByAPIKey(testpkg.Ctx(t), *device.APIKey)
	assert.ErrorIs(t, err, devicefleet.ErrDeviceNotFound, "the old key no longer authenticates")

	// A repeated removal finds no live device: nothing changes, no second
	// Geräteplatz is released and the first archive stamp stays.
	again := f.remove(t, device.ID)
	testutil.AssertNotFound(t, again)
	assert.Equal(t, before-1, f.liveDevicesOfTenant(t, tenantID))
	assert.True(t, stored.ArchivedAt.Equal(*f.stored(t, device.ID).ArchivedAt))

	entries := auditEntries(t, f.audit)
	require.Len(t, entries, 1, "only the effective removal is audited")
	assert.Equal(t, "removed", entries[0]["outcome"])
	assert.EqualValues(t, device.ID, entries[0]["device_row_id"])
	assert.NotContains(t, f.audit.String(), *device.APIKey)
}

func TestDeviceRemovalFreesTheDeviceIDForANewRegistration(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "removal-reuse")
	require.Equal(t, http.StatusOK, f.remove(t, device.ID).Code)

	again := testpkg.CreateTestDeviceForTenant(t, f.db, device.TenantID, "removal-reuse-second")
	_, err := f.db.NewUpdate().TableExpr("iot.devices").Set("device_id = ?", device.DeviceID).Where("id = ?", again.ID).Exec(context.Background())
	require.NoError(t, err, "a removed device's hardware ID can be connected again")
}

func TestDeviceRemovalCannotReachAnotherSchool(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	otherTenant, _ := testpkg.CreateTestTenant(t, f.db)
	foreign := testpkg.CreateTestDeviceForTenant(t, f.db, otherTenant, "removal-foreign")

	testutil.AssertNotFound(t, f.remove(t, foreign.ID))
	assert.Nil(t, f.stored(t, foreign.ID).ArchivedAt, "another school's device stays live")
}

// TestSessionStartWaitsForARemovalAndFindsNoLiveDevice holds a removal's row
// lock while a session start reads the device the way devicescanbinding's
// lifecycle store does: the start waits for the removal and then finds no
// live device, so no session can open on an archived device.
func TestSessionStartWaitsForARemovalAndFindsNoLiveDevice(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "removal-race")
	ctx := context.Background()

	removal, err := f.db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = removal.Rollback() }()
	_, err = removal.ExecContext(ctx, `SELECT id FROM iot.devices WHERE id = ? FOR UPDATE`, device.ID)
	require.NoError(t, err)
	_, err = removal.ExecContext(ctx, `UPDATE iot.devices SET archived_at = now(), api_key_hash = NULL WHERE id = ?`, device.ID)
	require.NoError(t, err)

	started := make(chan error, 1)
	go func() {
		tenantCtx := testpkg.TenantContext(device.TenantID)
		started <- testpkg.WithinTenantContext(t, tenantCtx, f.db, device.TenantID, func(ctx context.Context) error {
			_, err := f.fleet.FindDeviceForUpdate(ctx, device.ID)
			return err
		})
	}()

	require.Eventually(t, func() bool {
		var waiting int
		err := f.db.NewRaw(`SELECT count(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%iot.devices%FOR UPDATE%'`).Scan(ctx, &waiting)
		return err == nil && waiting > 0
	}, 10*time.Second, 20*time.Millisecond, "the session start waits for the removal's lock")
	select {
	case err := <-started:
		t.Fatalf("the session start did not wait for the removal: %v", err)
	default:
	}

	require.NoError(t, removal.Commit())
	assert.ErrorIs(t, <-started, devicefleet.ErrDeviceNotFound, "after the removal the start finds no live device")
}

func TestDeviceRemovalRefusesTheSystemDeviceAndAuditsIt(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	manual := testpkg.EnsureWebManualDevice(t, f.db)

	rr := f.remove(t, manual.ID)

	require.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())
	assert.Nil(t, f.stored(t, manual.ID).ArchivedAt)
	entries := auditEntries(t, f.audit)
	require.Len(t, entries, 1)
	assert.Equal(t, "rejected_protected", entries[0]["outcome"])
}
