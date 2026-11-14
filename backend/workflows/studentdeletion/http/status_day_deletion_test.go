package studentdeletionhttp_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/moto-ogs/project-phoenix/workflows/studentdeletion"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A child with status days carries a meal absence history. Its confirmed
// deletion cascades the status days; the history trigger must not record
// their removal for the deleted child (#5840: the DELETE answered 409
// students.deletion_constraints_changed on the foreign key of the history).
func TestStudentDeletionHandlers_DeletesChildWithStatusDaysAndMealHistory(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	ctx := testpkg.Ctx(t)
	target := testpkg.CreateTestStudent(t, tc.db, "StatusDelete", "Target", "2b")
	spared := testpkg.CreateTestStudent(t, tc.db, "StatusDelete", "Spared", "2b")
	foreignTenant, _ := testpkg.CreateTestTenant(t, tc.db)
	foreign := testpkg.CreateTestStudentForTenant(t, tc.db, foreignTenant, "StatusDelete", "Foreign", "2b")

	sick := calendar.NewDate(2026, time.September, 7)
	excused := calendar.NewDate(2026, time.September, 8)
	testpkg.CreateTestStudentStatusDay(t, tc.db, target.ID, sick, "sick")
	excusedDay := testpkg.CreateTestStudentStatusDay(t, tc.db, target.ID, excused, "excused")
	_, err := tc.db.NewRaw(`UPDATE active.student_status_days SET cleared_at = reported_at + INTERVAL '1 hour', cleared_source = 'manual' WHERE id = ?`,
		excusedDay.ID).Exec(ctx)
	require.NoError(t, err)
	testpkg.CreateTestStudentStatusDay(t, tc.db, spared.ID, sick, "sick")
	_, err = tc.db.NewRaw(`
		INSERT INTO active.student_status_days (tenant_id, student_id, date, status, reported_at, source)
		VALUES (?, ?, ?, 'sick', NOW(), 'manual')
	`, foreignTenant, foreign.ID, sick).Exec(ctx)
	require.NoError(t, err)

	require.Equal(t, 3, studentRows(t, tc, "schedule.meal_sickness_status_history", target.ID), "sick open, excused open and excused cleared")
	require.Equal(t, 1, studentRows(t, tc, "schedule.meal_sickness_status_history", spared.ID))
	require.Equal(t, 1, studentRows(t, tc, "schedule.meal_sickness_status_history", foreign.ID))

	actor := testpkg.CreateTestAccount(t, tc.db, "status-day-delete@example.com")
	claims := testutil.AdminTestClaims(int(actor.ID))
	preview := previewStudentDeletion(t, tc, claims, target.ID)
	encodedCounts, err := json.Marshal(preview["counts"])
	require.NoError(t, err)
	var previewCounts studentdeletion.Counts
	require.NoError(t, json.Unmarshal(encodedCounts, &previewCounts))
	assert.Equal(t, studentdeletion.Counts{AttendanceRecords: 2}, previewCounts, "both status days are shown, nothing else is linked")

	response := confirmStudentDeletion(t, tc, claims, target.ID, preview)
	require.Equal(t, http.StatusOK, response.Code, "Body: %s", response.Body.String())

	assert.Zero(t, studentDeletionRowCount(t, tc, "users.student_profiles", target.ID))
	assert.Zero(t, studentRows(t, tc, "active.student_status_days", target.ID), "the status days leave with the child")
	assert.Zero(t, studentRows(t, tc, "schedule.meal_sickness_status_history", target.ID), "no history survives, and none is recorded for the deleted child")

	assert.Equal(t, 1, studentRows(t, tc, "active.student_status_days", spared.ID), "another child's status day stays")
	assert.Equal(t, 1, studentRows(t, tc, "schedule.meal_sickness_status_history", spared.ID), "another child's history stays")
	assert.Equal(t, 1, studentRows(t, tc, "active.student_status_days", foreign.ID), "another school's status day stays")
	assert.Equal(t, 1, studentRows(t, tc, "schedule.meal_sickness_status_history", foreign.ID), "another school's history stays")

	var audit struct {
		Reason string          `bun:"reason"`
		Counts json.RawMessage `bun:"counts"`
	}
	require.NoError(t, tc.db.NewRaw(`
		SELECT reason, counts FROM audit.student_deletions
		WHERE tenant_id = ? AND student_id = ? AND actor_account_id = ?
	`, testpkg.Tenant(t), target.ID, actor.ID).Scan(ctx, &audit))
	assert.Equal(t, studentdeletion.ReasonTestData, audit.Reason)
	var auditCounts studentdeletion.Counts
	require.NoError(t, json.Unmarshal(audit.Counts, &auditCounts))
	assert.Equal(t, previewCounts, auditCounts, "the audit records exactly what the preview showed")
}

// studentRows counts a table's rows of one child by student_id.
func studentRows(t *testing.T, tc *testContext, table string, studentID int64) int {
	t.Helper()
	var count int
	require.NoError(t, tc.db.NewSelect().TableExpr(table).ColumnExpr("COUNT(*)").
		Where("student_id = ?", studentID).Scan(testpkg.Ctx(t), &count))
	return count
}
