package audit

import (
	"context"
	"testing"
	"time"

	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// auditTestNow is the fixed instant of the Audit clock in these tests: a
// school Monday, so no test depends on the day it runs (ADR 0239).
var auditTestNow = time.Date(2026, time.November, 2, 9, 30, 0, 0, time.UTC)

func auditTestClock() time.Time { return auditTestNow }

// TestAuditAppenderStampsEventsWithoutTheirTime pins the recording time of
// the ledgers a cutoff of the Audit clock reads: the Appender gives an
// event without its time the instant of the Audit clock, keeps a time the
// producer set, and refuses to stamp without a clock.
func TestAuditAppenderStampsEventsWithoutTheirTime(t *testing.T) {
	t.Parallel()

	appender := NewAppender(func(context.Context) (bun.IDB, int64) { return nil, 1 }, auditTestClock)
	auth := audit.NewAuthEvent(1, audit.EventTypeLogin, true, "192.0.2.1")
	deletion := audit.NewDataDeletion(1, audit.DeletionTypeManual, 1, "admin")
	field, session := &audit.StudentFieldEdit{}, &audit.WorkSessionEdit{}
	access, student := &audit.DataAccessLog{}, &audit.StudentDeletion{}
	enrollment, restoration := &audit.EnrollmentDeletion{}, &audit.EnrollmentRestoration{}
	stamps := map[any]*time.Time{auth: &auth.CreatedAt, deletion: &deletion.DeletedAt, field: &field.CreatedAt, session: &session.CreatedAt,
		access: &access.AccessedAt, student: &student.DeletedAt, enrollment: &enrollment.DeletedAt, restoration: &restoration.RestoredAt}
	for event, stamp := range stamps {
		require.True(t, stamp.IsZero(), "%T is built without its time", event)
		require.NoError(t, appender.stampRecordedAt(event))
		assert.True(t, auditTestNow.Equal(*stamp), "%T is stamped from the Audit clock", event)
	}

	recorded := auditTestNow.Add(-time.Hour)
	set := audit.NewAuthEvent(1, audit.EventTypeLogin, true, "192.0.2.1")
	set.CreatedAt = recorded
	require.NoError(t, appender.stampRecordedAt(set))
	assert.True(t, recorded.Equal(set.CreatedAt), "a time the producer set stays")

	unclocked := NewAppender(func(context.Context) (bun.IDB, int64) { return nil, 1 }, nil)
	require.ErrorContains(t, unclocked.stampRecordedAt(audit.NewAuthEvent(1, audit.EventTypeLogin, true, "192.0.2.1")), "clock is required")
	require.NoError(t, unclocked.stampRecordedAt(&audit.DeviationEvent{}), "a ledger without a recorded-at stamp needs no clock")
}

func TestAuditAppenderRequiresAuthoritativeTransaction(t *testing.T) {
	t.Parallel()

	appender := NewAppender(func(context.Context) (bun.IDB, int64) { return nil, 1 }, auditTestClock)
	event := audit.NewAuthEvent(1, audit.EventTypeLogin, true, "192.0.2.1")
	err := appender.Append(context.Background(), event)
	require.ErrorContains(t, err, "transaction is required")
}

func TestAuditAppenderAttributesTenantAndDatabaseEnforcesAppendOnlyRLS(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	ownTenant := testpkg.Tenant(t)
	otherTenant := testpkg.NewTenantScope(t, db).TenantID
	account := testpkg.CreateTestAccount(t, db, "audit-command-boundary@example.test")
	event := audit.NewAuthEvent(account.ID, audit.EventTypeLogin, true, "192.0.2.2")

	err := testpkg.WithTenantTx(t, context.Background(), db, ownTenant, func(txCtx context.Context, tx bun.Tx) error {
		appender := NewAppender(func(context.Context) (bun.IDB, int64) { return tx, ownTenant }, auditTestClock)
		return appender.Append(txCtx, event)
	})
	require.NoError(t, err)
	assert.Equal(t, ownTenant, event.TenantID)
	assert.Positive(t, event.ID)
	assert.Equal(t, account.ID, event.AccountID)
	assert.True(t, auditTestNow.Equal(event.CreatedAt), "an event without its time is stamped from the Audit clock")

	var mismatchErr error
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, ownTenant, func(txCtx context.Context, tx bun.Tx) error {
		mismatched := audit.NewAuthEvent(account.ID, audit.EventTypeLogin, true, "192.0.2.3")
		mismatched.SetTenantID(otherTenant)
		mismatchErr = NewAppender(func(context.Context) (bun.IDB, int64) { return tx, ownTenant }, auditTestClock).Append(txCtx, mismatched)
		return nil
	}))
	require.ErrorContains(t, mismatchErr, "does not match transaction tenant")

	assertAuditTenantWriteDenied(t, db, ownTenant, `UPDATE audit.auth_events SET success = FALSE WHERE id = ?`, event.ID)
	assertAuditTenantWriteDenied(t, db, ownTenant, `DELETE FROM audit.auth_events WHERE id = ?`, event.ID)
	assertAuditTenantWriteDenied(t, db, ownTenant, `
		INSERT INTO audit.auth_events (tenant_id, account_id, event_type, success, ip_address)
		VALUES (?, ?, 'login', TRUE, '192.0.2.4')`, otherTenant, account.ID)
}

func TestAuditOwnedAppendViewsRejectMutation(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)

	assertAuditTenantWriteDenied(t, db, tenantID, `UPDATE audit.file_event_ledger SET detail = detail WHERE FALSE`)
	assertAuditTenantWriteDenied(t, db, tenantID, `DELETE FROM audit.file_event_ledger WHERE FALSE`)
	assertAuditTenantWriteDenied(t, db, tenantID, `UPDATE audit.guardian_financial_change_ledger SET note = note WHERE FALSE`)
	assertAuditTenantWriteDenied(t, db, tenantID, `DELETE FROM audit.guardian_financial_change_ledger WHERE FALSE`)
}

func assertAuditTenantWriteDenied(t *testing.T, db *bun.DB, tenantID int64, query string, args ...any) {
	t.Helper()
	err := testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.NewRaw(query, args...).Exec(ctx)
		return err
	})
	require.Error(t, err)
	require.Equal(t, "42501", testpkg.PostgresSQLState(err))
}
