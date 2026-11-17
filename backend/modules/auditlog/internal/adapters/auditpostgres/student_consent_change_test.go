package audit

import (
	"strings"
	"testing"
	"time"

	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
		var databaseNow time.Time
		require.NoError(t, db.NewRaw(`SELECT clock_timestamp()`).Scan(ctx, &databaseNow))
		assert.WithinDuration(t, databaseNow, stored[0].CreatedAt, time.Minute, "the column default stamps the entry (ADR 0281, Nachtrag)")
	}
	require.NoError(t, testpkg.TenantCommand1(t, ctx, db, repo.CreateAll, nil), "an empty batch writes nothing")
}
