package audit

import (
	"context"
	"testing"
	"time"

	auditService "github.com/moto-ogs/project-phoenix/modules/auditlog/internal/application"
	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// auditClockYearsAhead is an Audit clock on the night of the 2031 clock
// change, years away from the database clock.
var auditClockYearsAhead = time.Date(2031, time.March, 30, 1, 30, 0, 0, calendar.Berlin)

// TestDatabaseGuardedLedgersStampOnTheDatabaseClock pins the clock of the
// ledgers whose retention functions guard their window on the database
// clock (ADR 0281, Nachtrag): an access, a student or enrollment deletion,
// an enrollment restoration and a file event carry the database time, even
// with an Audit clock years ahead and a producer that set its own time. The
// access-log deduplication finds the access on that clock.
func TestDatabaseGuardedLedgersStampOnTheDatabaseClock(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	account := testpkg.CreateTestAccount(t, db, "audit-database-clock@example.test")
	now := auditClockYearsAhead
	clock := func() time.Time { return now }

	access := &audit.DataAccessLog{ActorAccountID: account.ID, ActorRole: "admin", ResourceType: "attendance_history",
		RangeStart: now.AddDate(0, -1, 0), RangeEnd: now, AccessedAt: now, Metadata: map[string]any{"scope": "database-clock"}}
	student := &audit.StudentDeletion{StudentID: 99, ActorAccountID: &account.ID, Reason: "test_data", DeletedAt: now}
	enrollment := &audit.EnrollmentDeletion{RequestID: 98, ActorType: audit.EnrollmentDeletionActorSystem,
		Scope: audit.EnrollmentDeletionScopeChild, Reason: "retention"}
	restoration := &audit.EnrollmentRestoration{RequestID: 97, ChildIDs: []int64{}, ActorAccountID: &account.ID}
	file := &audit.FileEvent{Action: audit.FileEventFolderCreated, ActorName: "Verwaltung", Detail: "Ordner Elternbriefe"}

	var found, foundToday bool
	var databaseNow time.Time
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		runtime := func(context.Context) (bun.IDB, int64) { return tx, tenantID }
		accessLog := NewDataAccessLogRepository(runtime, clock)
		require.NoError(t, accessLog.Create(ctx, access))
		require.NoError(t, NewStudentDeletionRepository(runtime, clock).Create(ctx, student))
		require.NoError(t, NewEnrollmentDeletionRepository(runtime, clock).Create(ctx, enrollment))
		require.NoError(t, NewEnrollmentRestorationRepository(runtime, clock).Create(ctx, restoration))
		require.NoError(t, NewFileEventRepository(runtime, clock).Create(ctx, file))
		var err error
		if found, err = accessLog.ExistsWithin(ctx, account.ID, "attendance_history", map[string]string{"scope": "database-clock"}, time.Hour); err != nil {
			return err
		}
		if foundToday, err = accessLog.ExistsToday(ctx, account.ID, "attendance_history", map[string]string{"scope": "database-clock"}); err != nil {
			return err
		}
		databaseNow, err = NewAppender(runtime, clock).DatabaseTime(ctx)
		return err
	}))
	assert.True(t, found, "the access counts within the last hour of the database clock")
	assert.True(t, foundToday, "the access counts on the database clock's Berlin day")

	stored := func(query string, id int64) time.Time {
		var value time.Time
		require.NoError(t, db.NewRaw(query, id).Scan(context.Background(), &value))
		return value
	}
	for name, at := range map[string]time.Time{
		"access":                 stored(`SELECT accessed_at FROM audit.data_access_log WHERE id = ?`, access.ID),
		"student deletion":       stored(`SELECT deleted_at FROM audit.student_deletions WHERE id = ?`, student.ID),
		"enrollment deletion":    stored(`SELECT deleted_at FROM audit.enrollment_deletions WHERE id = ?`, enrollment.ID),
		"enrollment restoration": stored(`SELECT restored_at FROM audit.enrollment_restorations WHERE id = ?`, restoration.ID),
		"file event":             stored(`SELECT created_at FROM audit.file_events WHERE id = ?`, file.ID),
	} {
		assert.WithinDuration(t, databaseNow, at, time.Minute, "%s carries the database time", name)
	}
	assert.WithinDuration(t, databaseNow, access.AccessedAt, time.Minute, "the appender reads the stamp back")
}

// TestFileEventRetentionCutsOffOnTheDatabaseClock runs a protocol retention
// as the tenant role, which the database function guards on its own clock
// (1.15.454): with an Audit clock years ahead the step keeps a fresh event,
// deletes one of two years before, and the guard admits the cutoff. A cutoff
// of the Audit clock would exceed the window and fail the step.
func TestFileEventRetentionCutsOffOnTheDatabaseClock(t *testing.T) {
	t.Parallel()

	admin := testpkg.SetupTestDB(t)
	serve := testpkg.SetupServeTestDB(t)
	t.Cleanup(func() { require.NoError(t, serve.Close()) })
	tenantID := testpkg.Tenant(t)
	clock := func() time.Time { return auditClockYearsAhead }
	var aged int64
	require.NoError(t, admin.NewRaw(`INSERT INTO audit.file_events (tenant_id, action, actor_name, detail, created_at)
		VALUES (?, 'folder_created', 'Verwaltung', 'Ordner 2', clock_timestamp() - INTERVAL '2 years') RETURNING id`, tenantID).
		Scan(context.Background(), &aged))
	fresh := &audit.FileEvent{Action: audit.FileEventFolderCreated, ActorName: "Verwaltung", Detail: "Ordner Elternbriefe"}

	var deleted int
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), serve, tenantID, func(ctx context.Context, tx bun.Tx) error {
		runtime := func(context.Context) (bun.IDB, int64) { return tx, tenantID }
		require.NoError(t, NewFileEventRepository(runtime, clock).Create(ctx, fresh))
		command, err := auditService.NewCommand(NewAppender(runtime, clock), func(auditService.AppendObservation) {}, clock)
		require.NoError(t, err)
		deleted, _, err = command.DeleteExpiredProtocol(ctx, audit.DeletionTypeFileEventRetention)
		return err
	}))

	var remaining []int64
	require.NoError(t, admin.NewRaw(`SELECT id FROM audit.file_events WHERE tenant_id = ? AND id IN (?, ?) ORDER BY id`, tenantID, aged, fresh.ID).
		Scan(context.Background(), &remaining))
	assert.Equal(t, 1, deleted, "only the event of two years before is past the cutoff")
	assert.Equal(t, []int64{fresh.ID}, remaining, "the fresh event stays")
}
