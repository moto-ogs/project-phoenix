package test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// MarkTestStudentWithoutCarePlace turns a fixture child of the test's tenant
// into a child of the class without an OGS place (#4803): the mark is set
// and the group cleared, as the membership check requires.
func MarkTestStudentWithoutCarePlace(tb testing.TB, db *bun.DB, studentID int64) {
	tb.Helper()
	_, err := db.ExecContext(Ctx(tb), `UPDATE users.student_school_memberships
		SET without_care_place = true, group_id = NULL
		WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, Tenant(tb), studentID)
	require.NoError(tb, err)
}
