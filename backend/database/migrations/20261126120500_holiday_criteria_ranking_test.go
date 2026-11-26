package migrations

import (
	"testing"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestHolidayCriteriaRankingMigrationRollsBackAndReapplies(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	org := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Wertung", Slug: "traeger-wertung", Active: true})
	var criterionID int64
	require.NoError(t, db.NewRaw(`INSERT INTO enrollment.holiday_allocation_criteria
  (organization_id, name, question, scope, position, points)
  VALUES (?, 'Kriterium', 'Erfüllt?', 'family', 1, 100) RETURNING id`, org.ID).Scan(ctx, &criterionID))
	_, err := db.ExecContext(ctx, `INSERT INTO enrollment.holiday_allocation_rules
  (organization_id, criteria_ranking) VALUES (?, 'points')`, org.ID)
	require.NoError(t, err)

	require.NoError(t, holidayCriteriaRankingDown(ctx, db))
	var exists bool
	require.NoError(t, db.NewRaw(`SELECT to_regclass('enrollment.holiday_allocation_rules') IS NOT NULL`).Scan(ctx, &exists))
	require.False(t, exists)

	require.NoError(t, holidayCriteriaRankingUp(ctx, db))
	var points int
	require.NoError(t, db.NewRaw(`SELECT points FROM enrollment.holiday_allocation_criteria WHERE id = ?`, criterionID).Scan(ctx, &points))
	require.Equal(t, 1, points, "existing criteria get one point on upgrade")
	_, err = db.ExecContext(ctx, `UPDATE enrollment.holiday_allocation_criteria SET points = 101 WHERE id = ?`, criterionID)
	require.ErrorContains(t, err, "chk_holiday_allocation_criteria_points")
	_, err = db.ExecContext(ctx, `INSERT INTO enrollment.holiday_allocation_rules (organization_id, criteria_ranking) VALUES (?, 'invalid')`, org.ID)
	require.ErrorContains(t, err, "chk_holiday_allocation_rules_ranking")
}
