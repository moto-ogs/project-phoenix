package migrations

import (
	"context"
	"fmt"
	"testing"
	"time"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type homeBlockPolicyRow struct {
	Policies  map[string]string `bun:"policies,type:jsonb"`
	UpdatedAt time.Time         `bun:"updated_at"`
}

func homeBlockPolicyOf(t *testing.T, db bun.IDB, tenantID int64) homeBlockPolicyRow {
	t.Helper()
	var row homeBlockPolicyRow
	require.NoError(t, db.NewRaw(`
		SELECT policies, updated_at FROM config.home_block_policies WHERE tenant_id = ?
	`, tenantID).Scan(context.Background(), &row))
	return row
}

// One database setup, every case on its own school: "required" and "disabled"
// carry over, the old key goes, a school's own choice for „Heute anders“ wins,
// unrelated prescriptions stay, personal hides are not carried, and a second
// run changes nothing (#7668).
func TestHomeBlockDayChangesPolicyCarriesSchoolPrescription(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()

	cases := []struct {
		name   string
		stored string
		want   map[string]string
	}{
		{"required carries over", `{"section.staff_notices": "required", "section.recent_activity": "disabled"}`,
			map[string]string{"section.day_changes": "required", "section.recent_activity": "disabled"}},
		{"disabled carries over", `{"section.staff_notices": "disabled"}`,
			map[string]string{"section.day_changes": "disabled"}},
		{"the school's own choice wins", `{"section.staff_notices": "disabled", "section.day_changes": "required"}`,
			map[string]string{"section.day_changes": "required"}},
		{"optional only drops the key", `{"section.staff_notices": "optional", "section.birthdays": "required"}`,
			map[string]string{"section.birthdays": "required"}},
		{"without the old key nothing changes", `{"section.birthdays": "disabled"}`,
			map[string]string{"section.birthdays": "disabled"}},
	}
	schools := make([]int64, len(cases))
	for i, tc := range cases {
		schools[i], _ = testpkg.CreateTestTenant(t, db)
		_, err := db.ExecContext(ctx, `
			INSERT INTO config.home_block_policies (tenant_id, policies) VALUES (?, ?::jsonb)
		`, schools[i], tc.stored)
		require.NoError(t, err, tc.name)
	}

	// A person who hid the old block keeps exactly that row: the hide does not
	// become a hide of „Heute anders“.
	account := testpkg.CreateTestAccount(t, db, fmt.Sprintf("home-layout-%d@example.com", schools[0]))
	const personal = `{"section.staff_notices": false, "section.birthdays": false}`
	const arranged = `[{"key": "section.staff_notices", "span": 2, "col": 0, "row": 0}]`
	_, err := db.ExecContext(ctx, `
		INSERT INTO config.home_layouts (tenant_id, account_id, overrides, blocks)
		VALUES (?, ?, ?::jsonb, ?::jsonb)
	`, schools[0], account.ID, personal, arranged)
	require.NoError(t, err)

	require.NoError(t, homeBlockDayChangesPolicyUp(ctx, db))
	first := make([]homeBlockPolicyRow, len(cases))
	for i, tc := range cases {
		first[i] = homeBlockPolicyOf(t, db, schools[i])
		assert.Equal(t, tc.want, first[i].Policies, tc.name)
	}

	var overrides map[string]bool
	var blocks []map[string]any
	require.NoError(t, db.NewRaw(`
		SELECT overrides, blocks FROM config.home_layouts WHERE tenant_id = ? AND account_id = ?
	`, schools[0], account.ID).Scan(ctx, &overrides, &blocks))
	assert.Equal(t, map[string]bool{"section.staff_notices": false, "section.birthdays": false}, overrides)
	require.Len(t, blocks, 1)
	assert.Equal(t, "section.staff_notices", blocks[0]["key"])

	require.NoError(t, homeBlockDayChangesPolicyUp(ctx, db), "a second run")
	for i, tc := range cases {
		assert.Equal(t, first[i], homeBlockPolicyOf(t, db, schools[i]), "%s: a second run changes nothing", tc.name)
	}
}
