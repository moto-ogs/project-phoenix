package audit

import (
	"context"
	"testing"
	"time"

	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestLedgersWithAGoCutoffStampOnTheAuditClock pins the clock of the ledgers
// whose retention or window compares their time with a cutoff of the Audit
// clock (ADR 0281): an access, a student or enrollment deletion and an
// enrollment restoration recorded without its time carry the instant of the
// Audit clock, not the database's. The clock stands on the night of the
// 2031 clock change, years away from the database clock, so the access-log
// deduplication finds the access only on the Audit clock.
func TestLedgersWithAGoCutoffStampOnTheAuditClock(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	account := testpkg.CreateTestAccount(t, db, "audit-owner-clock@example.test")
	now := time.Date(2031, time.March, 30, 1, 30, 0, 0, calendar.Berlin)
	clock := func() time.Time { return now }

	access := &audit.DataAccessLog{ActorAccountID: account.ID, ActorRole: "admin", ResourceType: "attendance_history",
		RangeStart: now.AddDate(0, -1, 0), RangeEnd: now, Metadata: map[string]any{"scope": "owner-clock"}}
	student := &audit.StudentDeletion{StudentID: 99, ActorAccountID: &account.ID, Reason: "test_data"}
	enrollment := &audit.EnrollmentDeletion{RequestID: 98, ActorType: audit.EnrollmentDeletionActorSystem,
		Scope: audit.EnrollmentDeletionScopeChild, Reason: "retention"}
	restoration := &audit.EnrollmentRestoration{RequestID: 97, ChildIDs: []int64{}, ActorAccountID: &account.ID}

	var found bool
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		runtime := func(context.Context) (bun.IDB, int64) { return tx, tenantID }
		accessLog := NewDataAccessLogRepository(runtime, clock)
		require.NoError(t, accessLog.Create(ctx, access))
		require.NoError(t, NewStudentDeletionRepository(runtime, clock).Create(ctx, student))
		require.NoError(t, NewEnrollmentDeletionRepository(runtime, clock).Create(ctx, enrollment))
		require.NoError(t, NewEnrollmentRestorationRepository(runtime, clock).Create(ctx, restoration))
		var err error
		found, err = accessLog.ExistsSince(ctx, account.ID, "attendance_history", map[string]string{"scope": "owner-clock"}, now.Add(-time.Hour))
		return err
	}))
	assert.True(t, found, "the access counts since an hour ago on the Audit clock")

	stored := func(query string, id int64) time.Time {
		var value time.Time
		require.NoError(t, db.NewRaw(query, id).Scan(context.Background(), &value))
		return value
	}
	assert.True(t, now.Equal(stored(`SELECT accessed_at FROM audit.data_access_log WHERE id = ?`, access.ID)), "access")
	assert.True(t, now.Equal(stored(`SELECT deleted_at FROM audit.student_deletions WHERE id = ?`, student.ID)), "student deletion")
	assert.True(t, now.Equal(stored(`SELECT deleted_at FROM audit.enrollment_deletions WHERE id = ?`, enrollment.ID)), "enrollment deletion")
	assert.True(t, now.Equal(stored(`SELECT restored_at FROM audit.enrollment_restorations WHERE id = ?`, restoration.ID)), "enrollment restoration")
}
