package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// Migration 20261122114000 lets a planned weekly plan name the Träger-Büro as
// its author (#7818). The check is the model: the mark never stands beside a
// staff author, and the rollback refuses while a marked plan exists.
func TestEnrollmentWeeklyPlanByTraegerConstraintAndDown(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	phase := testpkg.CreateTestEnrollmentPhase(t, db)
	request := testpkg.CreateTestEnrollmentRequestAwaitingGuardian(t, db, phase.ID, "wochenplan-traeger@example.test", "weekly-plan-by-traeger")

	var childID int64
	require.NoError(t, db.NewRaw(`
		INSERT INTO enrollment.request_children
			(tenant_id, request_id, first_name, last_name, date_of_birth, status, sort_order, custom_data,
			 weekly_plan_on, weekly_plan_by_traeger)
		VALUES (?, ?, 'Mila', 'Wochenplan', '2018-04-15', 'approved', 0, '{}'::jsonb, '2026-09-01', TRUE)
		RETURNING id`, tenantID, request.ID).Scan(ctx, &childID))

	setAuthor := func(author any) error {
		_, err := db.ExecContext(ctx, `
			UPDATE enrollment.request_children SET weekly_plan_author = ?
			WHERE tenant_id = ? AND id = ?`, author, tenantID, childID)
		return err
	}
	require.ErrorContains(t, setAuthor(1), "chk_request_children_weekly_plan_author", "a staff author beside the mark")

	require.ErrorContains(t, enrollmentWeeklyPlanByTraegerDown(ctx, db), "cannot be rolled back")
	var marked bool
	require.NoError(t, db.NewRaw(`
		SELECT weekly_plan_by_traeger FROM enrollment.request_children
		WHERE tenant_id = ? AND id = ?`, tenantID, childID).Scan(ctx, &marked))
	require.True(t, marked, "the refused rollback keeps the plan and its mark")

	_, err := db.ExecContext(ctx, `
		UPDATE enrollment.request_children SET weekly_plan_by_traeger = FALSE
		WHERE tenant_id = ? AND id = ?`, tenantID, childID)
	require.NoError(t, err)
	require.NoError(t, setAuthor(1), "a staff author without the mark")
	require.NoError(t, enrollmentWeeklyPlanByTraegerDown(ctx, db))
	var columns int
	require.NoError(t, db.NewRaw(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = 'enrollment' AND table_name = 'request_children' AND column_name = 'weekly_plan_by_traeger'`).Scan(ctx, &columns))
	require.Zero(t, columns, "the rollback drops the mark")
}
