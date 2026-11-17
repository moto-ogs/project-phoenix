package audit

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/auditlog/consents"
	auditService "github.com/moto-ogs/project-phoenix/modules/auditlog/internal/application"
	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// CreateAll appends the consent changes of many students in one insert
// (#7208: switching child photos off ends every photo consent of a school)
// and writes none of them when one is invalid.
func TestStudentConsentChangeRepository_CreateAll(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	repo := NewStudentConsentChangeRepository(NewRuntime(db, auditTestTenantID), time.Now)
	ctx := testpkg.Ctx(t)
	first := testpkg.CreateTestStudent(t, db, "Einwilligung", "Eins", "1a")
	second := testpkg.CreateTestStudent(t, db, "Einwilligung", "Zwei", "1a")
	changedAt := time.Date(2026, time.November, 16, 9, 30, 0, 0, time.UTC)
	withdrawal := func(studentID int64) *audit.StudentConsentChange {
		return &audit.StudentConsentChange{
			Model:     audit.Model{CreatedAt: changedAt, UpdatedAt: changedAt},
			StudentID: studentID, ConsentKey: audit.StudentConsentPhoto,
			Action: audit.StudentConsentWithdrawn, Source: audit.StudentConsentSourceTenantPortal,
		}
	}

	err := testpkg.TenantCommand1(t, ctx, db, repo.CreateAll, []*audit.StudentConsentChange{withdrawal(first.ID), nil})
	require.ErrorContains(t, err, "cannot be nil")
	stored, err := testpkg.TenantQuery1(t, ctx, db, repo.ListByStudentID, first.ID)
	require.NoError(t, err)
	assert.Empty(t, stored, "a rejected batch writes no row")

	counter := testpkg.CaptureQueriesForContext(t, db)
	require.NoError(t, testpkg.TenantCommand1(t, counter.Context(ctx), db, repo.CreateAll,
		[]*audit.StudentConsentChange{withdrawal(first.ID), withdrawal(second.ID)}))
	inserts := counter.Matching(func(sql string) bool {
		return strings.HasPrefix(sql, "insert into audit.student_consent_changes")
	})
	assert.Len(t, inserts, 1, "every entry goes in one statement")

	for _, studentID := range []int64{first.ID, second.ID} {
		stored, err := testpkg.TenantQuery1(t, ctx, db, repo.ListByStudentID, studentID)
		require.NoError(t, err)
		require.Len(t, stored, 1)
		assert.Equal(t, audit.StudentConsentWithdrawn, stored[0].Action)
		assert.Equal(t, audit.StudentConsentPhoto, stored[0].ConsentKey)
		assert.Equal(t, testpkg.Tenant(t), stored[0].TenantID)
		assert.True(t, changedAt.Equal(stored[0].CreatedAt), "the entry keeps the instant of the switch")
	}
	require.NoError(t, testpkg.TenantCommand1(t, ctx, db, repo.CreateAll, nil), "an empty batch writes nothing")
}

// An import records a consent with the date of the CSV: the grant keeps the
// day the consent was given, years before the import and before both clocks,
// through the batch path of the recorder. A withdrawal later clears the live
// timestamp, so the ledger is the only record of the grant date.
func TestConsentRecorderKeepsTheGrantDateOfAnImport(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Einwilligung", "Import", "1a")
	granted := time.Date(2024, time.August, 1, 8, 0, 0, 0, time.UTC)
	clock := func() time.Time { return auditClockYearsAhead }

	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
		runtime := func(context.Context) (bun.IDB, int64) { return tx, tenantID }
		command, err := auditService.NewCommand(NewAppender(runtime, clock), func(auditService.AppendObservation) {}, clock)
		require.NoError(t, err)
		return auditService.NewConsentRecorder(command).RecordTransitionsAll(ctx, []consents.ConsentTransition{{
			After:  &consents.ConsentSnapshot{StudentID: student.ID, AGBAcceptedAt: &granted, PhotoConsentGivenAt: &granted},
			Source: audit.StudentConsentSourceImport, ChangedAt: auditClockYearsAhead,
		}})
	}))

	stored, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), db, NewStudentConsentChangeRepository(NewRuntime(db, auditTestTenantID), time.Now).ListByStudentID, student.ID)
	require.NoError(t, err)
	require.Len(t, stored, 2)
	for _, entry := range stored {
		assert.Equal(t, audit.StudentConsentGranted, entry.Action)
		assert.True(t, granted.Equal(entry.CreatedAt), "the %s grant keeps the date of the import, not %s", entry.ConsentKey, entry.CreatedAt)
	}
}
