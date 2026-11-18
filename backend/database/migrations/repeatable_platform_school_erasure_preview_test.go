package migrations

import (
	"encoding/json"
	"strings"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The preview counts exactly the targets and selectors of the installed
// erasure plan, and follows a change of the plan without an edit of its own
// (#7210).
func TestSchoolErasurePreviewFollowsThePlan(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	school := testpkg.Tenant(t)
	testpkg.CreateTestStudentForTenant(t, db, school, "Plan", "Child", "Fixture")
	operator := testpkg.CreateTestOperator(t, db)

	preview := func(q bun.IDB) map[string]int64 {
		var raw string
		require.NoError(t, q.NewRaw(`SELECT platform.school_erasure_preview(?, ?)::text`, school, operator.ID).Scan(ctx, &raw))
		counts := map[string]int64{}
		require.NoError(t, json.Unmarshal([]byte(raw), &counts))
		return counts
	}
	planCounts := map[string]int64{}
	for _, entry := range readErasurePlan(t, db) {
		var n int64
		require.NoError(t, db.NewRaw("SELECT count(*) FROM "+entry.Name+" AS r WHERE "+strings.ReplaceAll(entry.Predicate, "$1", "?"), school).Scan(ctx, &n))
		planCounts[entry.Name] = n
	}
	require.NotEmpty(t, planCounts)
	assert.Equal(t, planCounts, preview(db))
	assert.EqualValues(t, 1, planCounts["users.student_profiles"], "the fixture child is counted")

	// A plan reduced to the school root, in a transaction that never
	// commits: the preview counts only that target.
	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `CREATE OR REPLACE FUNCTION platform.school_erasure_plan() RETURNS jsonb LANGUAGE sql IMMUTABLE
		SET search_path TO 'pg_catalog' AS $function$ SELECT '[{"name": "platform.schools","predicate": "r.id = $1"}]'::jsonb $function$`)
	require.NoError(t, err)
	assert.Equal(t, map[string]int64{"platform.schools": 1}, preview(tx))
}
