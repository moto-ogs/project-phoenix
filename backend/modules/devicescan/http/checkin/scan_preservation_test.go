package checkin_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/devicescan"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestScanPreservesEveryNamedTableAcrossTenants(t *testing.T) {
	t.Parallel()
	db, module := setupCheckinModule(t)
	type fixture struct {
		tenantID, studentID, sourceVisitID, targetRoomID int64
		tag                                              string
		ctx                                              context.Context
	}
	create := func(t *testing.T, label string) fixture {
		t.Helper()
		activity := testpkg.CreateTestActivityGroup(t, db, label)
		sourceRoom := testpkg.CreateTestRoom(t, db, label+" source")
		targetRoom := testpkg.CreateTestRoom(t, db, label+" target")
		source := testpkg.CreateTestActiveGroup(t, db, activity.ID, sourceRoom.ID)
		targetActivity := testpkg.CreateTestActivityGroup(t, db, label+" destination")
		target := testpkg.CreateTestActiveGroup(t, db, targetActivity.ID, targetRoom.ID)
		staff := testpkg.CreateTestStaff(t, db, "Scan", label)
		device := testpkg.CreateTestDevice(t, db, label)
		testpkg.LinkDeviceToActiveGroup(t, db, target.ID, device.ID)
		testpkg.CreateTestGroupSupervisor(t, db, staff.ID, target.ID, "supervisor")
		student := testpkg.CreateTestStudent(t, db, "Scan", label, "1a")
		card := testpkg.CreateTestRFIDCard(t, db, fmt.Sprintf("SCAN%d", student.ID))
		testpkg.LinkRFIDToStudent(t, db, student.PersonID, card.ID)
		at := time.Now().Add(-time.Hour)
		visit := testpkg.CreateTestVisit(t, db, student.ID, source.ID, at, nil)
		testpkg.CreateTestAttendance(t, db, student.ID, staff.ID, device.ID, at, nil)
		testpkg.CreateTestScheduledCheckout(t, db, student.ID, staff.ID, time.Now().Add(time.Hour))
		var combinedID int64
		require.NoError(t, db.NewRaw("INSERT INTO active.combined_groups (tenant_id, start_time) VALUES (?, ?) RETURNING id", testpkg.Tenant(t), at).Scan(context.Background(), &combinedID))
		_, err := db.NewRaw("INSERT INTO active.group_mappings (tenant_id, active_group_id, active_combined_group_id) VALUES (?, ?, ?)", testpkg.Tenant(t), source.ID, combinedID).Exec(context.Background())
		require.NoError(t, err)
		req := testutil.NewAuthenticatedRequest(t, "POST", "/checkin", nil, testutil.WithDeviceContext(device), testutil.WithStaffContext(staff.ID, staff.TenantID))
		return fixture{testpkg.Tenant(t), student.ID, visit.ID, targetRoom.ID, card.ID, req.Context()}
	}
	own := create(t, "OWN-SCAN")
	var foreign fixture
	t.Run("foreign fixture", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign = create(t, "FOREIGN-SCAN")
	})
	tables := []string{"iot.devices", "active.attendance", "active.visits", "active.groups", "active.group_mappings", "active.group_supervisors", "active.scheduled_checkouts"}
	queries := make(testpkg.SnapshotQueries, len(tables))
	for _, table := range tables {
		queries[table] = `SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.id), '[]'::json)
			FROM ` + table + ` AS r WHERE r.tenant_id = $1`
	}
	readSnapshot := queries.Prepare(t, db)
	snapshot := func(tenantID int64) map[string]string {
		t.Helper()
		rows, err := readSnapshot(context.Background(), tenantID)
		require.NoError(t, err)
		for _, table := range tables {
			require.Contains(t, rows, table)
			require.NotEqual(t, "[]", rows[table], "fixture must populate %s", table)
		}
		return rows
	}
	ownBefore, foreignBefore := snapshot(own.tenantID), snapshot(foreign.tenantID)
	countQueries := make(testpkg.SnapshotQueries, len(tables))
	for _, table := range tables {
		countQueries[table] = `SELECT count(*) FROM ` + table + ` WHERE tenant_id = ?0`
	}
	for _, pair := range [][2]int64{{own.tenantID, foreign.tenantID}, {foreign.tenantID, own.tenantID}} {
		ctx := testpkg.ContextForTenant(testpkg.Ctx(t), pair[0])
		require.NoError(t, testpkg.WithTenantTx(t, ctx, db, pair[0], func(txCtx context.Context, tx testpkg.Tx) error {
			ownCounts := countQueries.ReadCounts(t, txCtx, tx, pair[0])
			foreignCounts := countQueries.ReadCounts(t, txCtx, tx, pair[1])
			for _, table := range tables {
				require.Positive(t, ownCounts[table], "own rows in %s must be visible", table)
				require.Zero(t, foreignCounts[table], "foreign rows in %s must be hidden", table)
			}
			return nil
		}))
	}
	abort := errors.New("abort after actual scan owner writes")
	scan := func(fail bool) error {
		return testpkg.WithTenantTx(t, own.ctx, db, own.tenantID, func(txCtx context.Context, tx testpkg.Tx) error {
			result, err := module.DeviceScan.Scan(txCtx, devicescan.ScanCommand{RFIDTag: own.tag, RoomID: &own.targetRoomID})
			require.NoError(t, err)
			require.Equal(t, devicescan.ScanActionTransferred, result.Action)
			var closed bool
			require.NoError(t, tx.NewRaw("SELECT exit_time IS NOT NULL FROM active.visits WHERE id = ?", own.sourceVisitID).Scan(txCtx, &closed))
			require.True(t, closed)
			var visits int
			require.NoError(t, tx.NewRaw("SELECT count(*) FROM active.visits WHERE student_id = ? AND exit_time IS NULL", own.studentID).Scan(txCtx, &visits))
			require.Equal(t, 1, visits, "the destination write must happen before injected failure")
			if fail {
				return abort
			}
			return nil
		})
	}
	require.ErrorIs(t, scan(true), abort)
	require.Equal(t, ownBefore, snapshot(own.tenantID))
	require.Equal(t, foreignBefore, snapshot(foreign.tenantID))
	require.NoError(t, scan(false))
	require.NotNil(t, testpkg.VisitExitTime(t, db, own.sourceVisitID))
	require.Equal(t, foreignBefore, snapshot(foreign.tenantID))
	ownAfter := snapshot(own.tenantID)
	for _, table := range []string{"active.group_mappings", "active.group_supervisors", "active.scheduled_checkouts", "active.attendance"} {
		require.Equal(t, ownBefore[table], ownAfter[table], table)
	}
}
