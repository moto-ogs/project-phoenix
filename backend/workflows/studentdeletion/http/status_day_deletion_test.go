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

	require.Equal(t, 3, mealHistoryRows(t, tc, target.ID), "sick open, excused open and excused cleared")
	require.Equal(t, 1, mealHistoryRows(t, tc, spared.ID))
	require.Equal(t, 1, mealHistoryRows(t, tc, foreign.ID))

	actor := testpkg.CreateTestAccount(t, tc.db, "status-day-delete@example.com")
	claims := testutil.AdminTestClaims(int(actor.ID))
	preview := previewStudentDeletion(t, tc, claims, target.ID)
	counts, ok := preview["counts"].(map[string]any)
	require.True(t, ok, "preview counts: %v", preview)
	assert.InDelta(t, 2, counts["attendance_records"], 0, "both status days are shown as attendance records")

	response := confirmStudentDeletion(t, tc, claims, target.ID, preview)
	require.Equal(t, http.StatusOK, response.Code, "Body: %s", response.Body.String())

	assert.Zero(t, studentDeletionRowCount(t, tc, "users.student_profiles", target.ID))
	assert.Zero(t, statusDayRows(t, tc, target.ID), "the status days leave with the child")
	assert.Zero(t, mealHistoryRows(t, tc, target.ID), "no history survives, and none is recorded for the deleted child")

	assert.Equal(t, 1, statusDayRows(t, tc, spared.ID), "another child's status day stays")
	assert.Equal(t, 1, mealHistoryRows(t, tc, spared.ID), "another child's history stays")
	assert.Equal(t, 1, statusDayRows(t, tc, foreign.ID), "another school's status day stays")
	assert.Equal(t, 1, mealHistoryRows(t, tc, foreign.ID), "another school's history stays")

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
	assert.Equal(t, 2, auditCounts.AttendanceRecords, "the audit records the status days the preview showed")
}

func statusDayRows(t *testing.T, tc *testContext, studentID int64) int {
	t.Helper()
	var count int
	require.NoError(t, tc.db.NewRaw(`SELECT COUNT(*) FROM active.student_status_days WHERE student_id = ?`, studentID).
		Scan(testpkg.Ctx(t), &count))
	return count
}

func mealHistoryRows(t *testing.T, tc *testContext, studentID int64) int {
	t.Helper()
	var count int
	require.NoError(t, tc.db.NewRaw(`SELECT COUNT(*) FROM schedule.meal_sickness_status_history WHERE student_id = ?`, studentID).
		Scan(testpkg.Ctx(t), &count))
	return count
}
