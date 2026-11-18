package httpintegration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// #2697 names daily attendance and staff assignments even though ending a
// room session must not change either. Cover real rows, not empty tables,
// alongside rollback and RLS for every named table.
func TestSessionEndPreservesAttendanceAndStaffAcrossTenants(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	_, err := api.NewActiveTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	moduleSessionEnd := api.NewActiveTestSessionEnd(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	type fixture struct{ tenantID, groupID, instanceID int64 }
	create := func(t *testing.T, label string) fixture {
		t.Helper()
		activity := testpkg.CreateTestActivityGroup(t, db, label)
		room := testpkg.CreateTestRoom(t, db, label)
		group := testpkg.CreateTestActiveGroup(t, db, activity.ID, room.ID)
		staff := testpkg.CreateTestStaff(t, db, "Preserved", label)
		device := testpkg.CreateTestDevice(t, db, label)
		student := testpkg.CreateTestStudent(t, db, "Preserved", label, "1a")
		testpkg.CreateTestGroupSupervisor(t, db, staff.ID, group.ID, "supervisor")
		checkedIn := time.Now().Add(-time.Hour)
		testpkg.CreateTestVisit(t, db, student.ID, group.ID, checkedIn, nil)
		testpkg.CreateTestAttendance(t, db, student.ID, staff.ID, device.ID, checkedIn, nil)
		instance := testpkg.CreateTestActivityInstance(t, db, testpkg.TodayDate(), room.ID, testpkg.ActivityInstanceOpts{
			Status: "active", ActivityGroupID: &activity.ID, ActiveGroupID: &group.ID, IsSpontaneous: true,
		})
		testpkg.CreateTestInstanceStudent(t, db, instance.ID, student.ID, "present", testpkg.InstanceStudentOpts{CheckedInAt: &checkedIn})
		testpkg.CreateTestInstanceStaff(t, db, instance.ID, staff.ID, testpkg.InstanceStaffOpts{IsPrimary: true})
		return fixture{testpkg.Tenant(t), group.ID, instance.ID}
	}
	own := create(t, "Own session preservation")
	var foreign fixture
	t.Run("foreign fixture", func(t *testing.T) {
		testpkg.OwnTenant(t)
		foreign = create(t, "Foreign session preservation")
	})
	tables := []string{
		"schedule.activity_instances", "schedule.instance_staff", "schedule.instance_students",
		"active.activity_sessions", "active.activity_session_attendance",
		"active.attendance", "active.visits", "active.groups", "active.group_supervisors",
	}
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
	// Probe actual least-privilege RLS in both directions over populated rows.
	countQueries := make(testpkg.SnapshotQueries, len(tables))
	for _, table := range tables {
		countQueries[table] = `SELECT count(*) FROM ` + table + ` WHERE tenant_id = ?0`
	}
	for _, pair := range [][2]int64{{own.tenantID, foreign.tenantID}, {foreign.tenantID, own.tenantID}} {
		ctx := testpkg.ContextForTenant(testpkg.Ctx(t), pair[0])
		require.NoError(t, testpkg.WithTenantTx(t, ctx, db, pair[0], func(txCtx context.Context, tx bun.Tx) error {
			ownCounts := countQueries.ReadCounts(t, txCtx, tx, pair[0])
			foreignCounts := countQueries.ReadCounts(t, txCtx, tx, pair[1])
			for _, table := range tables {
				require.Positive(t, ownCounts[table], "own rows in %s must be visible", table)
				require.Zero(t, foreignCounts[table], "foreign rows in %s must be hidden", table)
			}
			return nil
		}))
	}
	abort := errors.New("abort after real session-end owners")
	err = testpkg.WithTenantTx(t, testpkg.Ctx(t), db, own.tenantID, func(txCtx context.Context, tx bun.Tx) error {
		result, err := moduleSessionEnd.SessionEnd.EndSession(txCtx, own.groupID)
		require.NoError(t, err)
		require.Equal(t, 1, result.StudentsCheckedOut)
		var status string
		require.NoError(t, tx.NewRaw("SELECT status FROM active.activity_sessions WHERE schedule_instance_id = ?", own.instanceID).Scan(txCtx, &status))
		require.Equal(t, "completed", status, "real Timetable mutation must happen before injected failure")
		return abort
	})
	require.ErrorIs(t, err, abort)
	require.Equal(t, ownBefore, snapshot(own.tenantID), "all owner writes must roll back")
	require.Equal(t, foreignBefore, snapshot(foreign.tenantID))

	_, err = moduleSessionEnd.SessionEnd.EndSession(testpkg.Ctx(t), own.groupID)
	require.NoError(t, err)
	ownAfter := snapshot(own.tenantID)
	for _, table := range []string{"schedule.instance_staff", "active.attendance"} {
		require.Equal(t, ownBefore[table], ownAfter[table], "session end must preserve every column of %s", table)
	}
	require.Equal(t, foreignBefore, snapshot(foreign.tenantID), "successful end must preserve every foreign row")
	require.Equal(t, "completed", testpkg.InstanceStatus(t, db, own.instanceID))
	require.Equal(t, "active", testpkg.InstanceStatus(t, db, foreign.instanceID))

	// Moved from the opt-in TestSessionEndRuntimeEvidence (#4426): ending the
	// ended session is refused without writing a row.
	counter := testpkg.CaptureQueriesForContext(t, db)
	_, err = moduleSessionEnd.SessionEnd.EndSession(counter.Context(testpkg.Ctx(t)), own.groupID)
	require.EqualError(t, err, "active group session already ended")
	require.Zero(t, counter.WriteRows(), "a refused end must not write")
	require.Equal(t, ownAfter, snapshot(own.tenantID))
}
