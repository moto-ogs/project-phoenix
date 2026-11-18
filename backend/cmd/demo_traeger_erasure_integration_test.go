package cmd

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	tenancyCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func demoTraegerExists(t *testing.T, db *bun.DB, organizationID int64) bool {
	t.Helper()
	var n int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.organizations WHERE id = ?`, organizationID).Scan(t.Context(), &n))
	return n == 1
}

// A demo order's own Träger (#6193, ADR 0271) goes with its last school: the
// demo process erases the Träger, its office and its Träger tables in the
// run that erased the school, as phoenix_demo, and records counts on the
// Träger's demo origin. A Träger without a demo origin, such as the shared
// Demo-Träger, never goes, even once it has no school.
func TestDemoProcessErasesTheOwnDemoTraegerAfterItsLastSchool(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()

	own := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Ganztag Nord e. V.", Slug: "traeger-ogs-nord-abc123"})
	shared := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Demo-Träger Nord", Slug: "demo-traeger-nord-erasure"})
	school := testpkg.CreateTestSchoolInOrganization(t, db, own.ID, "OGS Nord")
	neighbour := testpkg.CreateTestSchoolInOrganization(t, db, own.ID, "OGS Am Lindenhof")
	// A person with an RFID card: the card goes after the person, or its
	// (tenant_id, tag_id) SET NULL key empties the person's school (#6193).
	_, err := db.NewRaw(`INSERT INTO users.rfid_cards (id, tenant_id, active) VALUES ('DEMOCARD' || ?::text, ?, true)`, school, school).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw(`INSERT INTO users.persons (tenant_id, first_name, last_name, tag_id) VALUES (?, 'Demo', 'Kind', 'DEMOCARD' || ?::text)`, school, school).Exec(ctx)
	require.NoError(t, err)
	// A Nachweis references its contribution rule; the root's cascade may
	// reach the rule before the contract that takes the Nachweis along, so
	// the erasure defers that key over the cascade (#6193, #7248).
	_, err = db.NewRaw(`WITH rule AS (
			INSERT INTO parent_billing.contribution_rules (organization_id, service, kind, valid_from, note)
			VALUES (?0, 'holiday', 'benefits_exemption', '2026-11-01', 'Bescheid liegt vor') RETURNING id),
		contract AS (INSERT INTO care_contract.contracts (organization_id, school_id, import_origin) VALUES (?0, ?1, 'demo-import') RETURNING id)
		INSERT INTO parent_billing.care_evidences (organization_id, care_contract_id, kind, valid_from, evidence, checked_on, rule_id)
		SELECT ?0, contract.id, 'income_level', '2026-11-01', 'Einkommensteuerbescheid', '2026-11-16', rule.id FROM rule, contract`,
		own.ID, school).Exec(ctx)
	require.NoError(t, err)
	member := testpkg.CreateTestAccount(t, db, "demo-traeger-buero")
	_, err = db.NewRaw(`INSERT INTO platform.organization_accounts (organization_id, account_id, status, activated_at)
		VALUES (?, ?, 'active', NOW())`, own.ID, member.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw(`INSERT INTO auth.organization_account_roles (organization_id, account_id, role)
		VALUES (?, ?, 'administration')`, own.ID, member.ID).Exec(ctx)
	require.NoError(t, err)

	// The order names its Träger and both schools; the visitor erasure
	// deletes the order, the trigger's origins remain.
	_, err = db.NewRaw(`INSERT INTO platform.demo_school_states (name, tenant_id, seed_state, status, traeger_id, visitor_school_ids)
		VALUES ('ogs-nord-abc123', ?, '{}'::jsonb, 'ready', ?, ARRAY[?, ?]::BIGINT[])`, school, own.ID, school, neighbour).Exec(ctx)
	require.NoError(t, err)

	demoDB := testpkg.DemoRoleDatabase(t, db)
	erasure, err := tenancyCompose.NewDemoSchoolErasure(demoDB, objects.NewLocal(t.TempDir()))
	require.NoError(t, err)

	_, err = db.NewRaw(`DELETE FROM platform.demo_school_states WHERE name = 'ogs-nord-abc123'`).Exec(ctx)
	require.NoError(t, err)
	hideDemoSchool(t, db, school, "91 days")
	hideDemoSchool(t, db, neighbour, "89 days")
	_, _, err = erasure.EraseRetiredDemoSchoolFiles(ctx)
	require.NoError(t, err)
	erased, _, err := erasure.EraseRetiredDemoSchoolDatabases(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, erased, "the school retired 91 days ago")
	assert.True(t, demoTraegerExists(t, db, own.ID), "the Träger waits for its last school")

	hideDemoSchool(t, db, neighbour, "91 days")
	erased, _, err = erasure.EraseRetiredDemoSchoolDatabases(ctx)
	require.NoError(t, err)
	assert.Equal(t, 2, erased, "the neighbour school, then its Träger in the same run")
	assert.False(t, demoTraegerExists(t, db, own.ID))
	var memberships, roles int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.organization_accounts WHERE organization_id = ?`, own.ID).Scan(ctx, &memberships))
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.organization_account_roles WHERE organization_id = ?`, own.ID).Scan(ctx, &roles))
	assert.Zero(t, memberships)
	assert.Zero(t, roles)
	var evidences int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM parent_billing.care_evidences WHERE organization_id = ?`, own.ID).Scan(ctx, &evidences))
	assert.Zero(t, evidences)
	var evidence struct {
		Erased bool   `bun:"erased"`
		Counts string `bun:"counts"`
	}
	require.NoError(t, db.NewRaw(`SELECT erased_at IS NOT NULL AS erased, row_counts::text AS counts
		FROM platform.demo_traeger_origins WHERE organization_id = ?`, own.ID).Scan(ctx, &evidence))
	assert.True(t, evidence.Erased)
	assert.Contains(t, evidence.Counts, `"platform.organization_accounts": 1`)

	// The shared Demo-Träger has no demo origin: no school and still there.
	assert.True(t, demoTraegerExists(t, db, shared.ID))
	erased, _, err = erasure.EraseRetiredDemoSchoolDatabases(ctx)
	require.NoError(t, err)
	assert.Zero(t, erased, "a second run finds nothing left to do")
	assert.True(t, demoTraegerExists(t, db, shared.ID))
}
