package studentpresencehttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type roomHistoryStopBody struct {
	Data struct {
		Stopped       bool       `json:"stopped"`
		StoppedAt     *time.Time `json:"stopped_at"`
		DeletedVisits int64      `json:"deleted_visits"`
	} `json:"data"`
}

func decodeRoomHistoryStop(t *testing.T, body []byte) roomHistoryStopBody {
	t.Helper()
	var decoded roomHistoryStopBody
	require.NoError(t, json.Unmarshal(body, &decoded), string(body))
	return decoded
}

// TestRoomHistoryStopRoutes walks the per-child stop of #3844 through its
// routes: only the OGS administration sets and lifts it, setting it deletes
// the completed visits but keeps the current room, a visit closing later is
// not kept, and each effective change lands in the change history and the
// deletion log without any room or time of the child.
func TestRoomHistoryStopRoutes(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t)
	ctx := testpkg.Ctx(t)
	student := testpkg.CreateTestStudent(t, tc.db, "Stopp", "Route", "4a")
	group := testpkg.CreateTestActiveGroupForTenant(t, tc.db, student.TenantID)
	entry := time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC)
	_, err := tc.db.ExecContext(ctx, `INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time, exit_time)
		VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, NULL)`,
		student.TenantID, student.ID, group.ID, entry, entry.Add(time.Hour),
		student.TenantID, student.ID, group.ID, entry.Add(2*time.Hour))
	require.NoError(t, err)
	path := fmt.Sprintf("/%d/room-history-stop", student.ID)
	admin := testutil.AdminTestClaims(1)
	visits := func(closed bool) int {
		var count int
		require.NoError(t, tc.db.NewRaw(`SELECT count(*) FROM active.visits WHERE tenant_id = ? AND student_id = ? AND (exit_time IS NOT NULL) = ?`,
			student.TenantID, student.ID, closed).Scan(ctx, &count))
		return count
	}
	changes := func() int {
		var count int
		require.NoError(t, tc.db.NewRaw(`SELECT count(*) FROM audit.student_field_edits WHERE tenant_id = ? AND student_id = ? AND field_name = 'room_history_stop'`,
			student.TenantID, student.ID).Scan(ctx, &count))
		return count
	}

	rr := authExec(t, tc, testutil.NewRequest("GET", path, nil), admin, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.False(t, decodeRoomHistoryStop(t, rr.Body.Bytes()).Data.Stopped)

	rr = authExec(t, tc, testutil.NewAuthenticatedRequest(t, "PUT", path, nil), admin, []string{"users:read", "users:update"})
	assert.Equal(t, http.StatusForbidden, rr.Code, "staff without config:manage cannot stop: %s", rr.Body.String())
	assert.Equal(t, 1, visits(true), "a refused stop deletes nothing")

	rr = authExec(t, tc, testutil.NewAuthenticatedRequest(t, "PUT", path, nil), admin, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	stopped := decodeRoomHistoryStop(t, rr.Body.Bytes())
	assert.True(t, stopped.Data.Stopped)
	assert.EqualValues(t, 1, stopped.Data.DeletedVisits)
	assert.Zero(t, visits(true), "the completed visit is deleted at once")
	assert.Equal(t, 1, visits(false), "the current room stays visible")
	assert.Equal(t, 1, changes())
	var deletion struct {
		Records   int    `bun:"records_deleted"`
		DeletedBy string `bun:"deleted_by"`
	}
	require.NoError(t, tc.db.NewRaw(`SELECT records_deleted, deleted_by FROM audit.data_deletions WHERE tenant_id = ? AND student_id = ? AND deletion_type = 'room_history_stop'`,
		student.TenantID, student.ID).Scan(ctx, &deletion))
	assert.Equal(t, 1, deletion.Records)
	assert.Equal(t, "account:1", deletion.DeletedBy)

	_, err = tc.db.ExecContext(ctx, `UPDATE active.visits SET exit_time = ? WHERE tenant_id = ? AND student_id = ? AND exit_time IS NULL`,
		entry.Add(3*time.Hour), student.TenantID, student.ID)
	require.NoError(t, err)
	assert.Zero(t, visits(true), "a visit closing during the stop is not kept")

	rr = authExec(t, tc, testutil.NewAuthenticatedRequest(t, "PUT", path, nil), admin, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Zero(t, decodeRoomHistoryStop(t, rr.Body.Bytes()).Data.DeletedVisits)
	assert.Equal(t, 1, changes(), "stopping a stopped child records nothing again")

	rr = authExec(t, tc, testutil.NewRequest("GET", path, nil), admin, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	read := decodeRoomHistoryStop(t, rr.Body.Bytes())
	assert.True(t, read.Data.Stopped)
	assert.NotNil(t, read.Data.StoppedAt)

	rr = authExec(t, tc, testutil.NewAuthenticatedRequest(t, "DELETE", path, nil), admin, []string{"users:read", "users:update"})
	assert.Equal(t, http.StatusForbidden, rr.Code, "staff without config:manage cannot lift the stop")
	rr = authExec(t, tc, testutil.NewAuthenticatedRequest(t, "DELETE", path, nil), admin, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.False(t, decodeRoomHistoryStop(t, rr.Body.Bytes()).Data.Stopped)
	assert.Equal(t, 2, changes())

	_, err = tc.db.ExecContext(ctx, `INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time, exit_time) VALUES (?, ?, ?, ?, ?)`,
		student.TenantID, student.ID, group.ID, entry.Add(4*time.Hour), entry.Add(5*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 1, visits(true), "after the lift the history records again")
}
