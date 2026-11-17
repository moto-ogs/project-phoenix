package audit

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/auditlog/classlist"
	"github.com/moto-ogs/project-phoenix/modules/auditlog/consents"
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

// TestAuditAppenderLeavesTheDatabaseStampsToTheColumnDefault pins the
// recording time of the ledgers (ADR 0281, Nachtrag): the Appender clears a
// time the producer set on every ledger the database stamps, so the column
// default stamps it, and gives a work session edit without its time the
// instant of the Audit clock, keeps one the producer set, and refuses to
// stamp it without a clock.
func TestAuditAppenderLeavesTheDatabaseStampsToTheColumnDefault(t *testing.T) {
	t.Parallel()

	appender := NewAppender(func(context.Context) (bun.IDB, int64) { return nil, 1 }, auditTestClock)
	auth := audit.NewAuthEvent(1, audit.EventTypeLogin, true, "192.0.2.1")
	deletion := audit.NewDataDeletion(1, audit.DeletionTypeManual, 1, "admin")
	field := &audit.StudentFieldEdit{}
	access, student := &audit.DataAccessLog{}, &audit.StudentDeletion{}
	enrollment, restoration := &audit.EnrollmentDeletion{}, &audit.EnrollmentRestoration{}
	stamps := map[any]*time.Time{auth: &auth.CreatedAt, deletion: &deletion.DeletedAt, field: &field.CreatedAt,
		access: &access.AccessedAt, student: &student.DeletedAt, enrollment: &enrollment.DeletedAt, restoration: &restoration.RestoredAt}
	file, substitution := &audit.FileEvent{}, &audit.SubstitutionChange{}
	classRow, classEvent := &audit.ClassListEntryChange{}, &classlist.ClassListEntryChange{}
	staff, number, bank, timeDeletion := &audit.StaffMasterDataChange{}, &audit.PersonnelNumberChange{}, &audit.GuardianFinancialChange{}, &audit.TimeTrackingDeletion{}
	guardian, consentRow, consentEvent, correction := &audit.GuardianChange{}, &audit.StudentConsentChange{}, &consents.ConsentChange{}, &audit.AttendanceCorrection{}
	for event, stamp := range map[any]*time.Time{file: &file.CreatedAt, substitution: &substitution.CreatedAt, classRow: &classRow.OccurredAt,
		classEvent: &classEvent.OccurredAt, staff: &staff.OccurredAt, number: &number.OccurredAt, bank: &bank.OccurredAt,
		timeDeletion: &timeDeletion.OccurredAt, guardian: &guardian.ChangedAt, consentRow: &consentRow.CreatedAt,
		consentEvent: &consentEvent.ChangedAt, correction: &correction.CreatedAt} {
		stamps[event] = stamp
	}
	for event, stamp := range stamps {
		*stamp = auditTestNow
		require.NoError(t, appender.stampRecordedAt(event))
		assert.True(t, stamp.IsZero(), "%T is left to the column default", event)
	}

	session := &audit.WorkSessionEdit{}
	require.NoError(t, appender.stampRecordedAt(session))
	assert.True(t, auditTestNow.Equal(session.CreatedAt), "a work session edit is stamped from the Audit clock")
	recorded := auditTestNow.Add(-time.Hour)
	set := &audit.WorkSessionEdit{CreatedAt: recorded}
	require.NoError(t, appender.stampRecordedAt(set))
	assert.True(t, recorded.Equal(set.CreatedAt), "a time the producer set stays")

	unclocked := NewAppender(func(context.Context) (bun.IDB, int64) { return nil, 1 }, nil)
	require.ErrorContains(t, unclocked.stampRecordedAt(&audit.WorkSessionEdit{}), "clock is required")
	require.NoError(t, unclocked.stampRecordedAt(audit.NewAuthEvent(1, audit.EventTypeLogin, true, "192.0.2.1")), "a ledger the database stamps needs no clock")
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
	var databaseNow time.Time
	require.NoError(t, db.NewRaw(`SELECT clock_timestamp()`).Scan(context.Background(), &databaseNow))
	assert.WithinDuration(t, databaseNow, event.CreatedAt, time.Minute, "the column default stamps the event (ADR 0281, Nachtrag)")

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
