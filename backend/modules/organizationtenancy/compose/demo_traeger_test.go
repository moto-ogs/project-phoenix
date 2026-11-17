package compose

import (
	"context"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An order with a Träger of its own (#6193, ADR 0271) owns every school of
// it. Its retirement hides the neighbour schools with the visitor's school
// and ends the sessions of the Träger-Portal and of all its schools; the
// visitor erasure then takes the visitor's membership in the office, its
// roles and the ledger entries that name the visitor. The Träger stays for
// its schools' database erasure, proven a demo Träger by its origin.
func TestDemoRetirementTakesTheOrdersOwnTraegerAlong(t *testing.T) {
	t.Parallel()
	order := newDemoOrder(t)
	ctx := t.Context()
	db := order.db
	traeger := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Ganztag Nord e. V.", Slug: "traeger-" + order.slug})
	_, err := db.NewRaw(`UPDATE platform.schools SET organization_id = ? WHERE id = ?`, traeger.ID, order.schoolID).Exec(ctx)
	require.NoError(t, err)
	neighbour := testpkg.CreateTestSchoolInOrganization(t, db, traeger.ID, "OGS Am Lindenhof")
	schools, err := NewDemoSchools(db)
	require.NoError(t, err)
	require.NoError(t, schools.RecordDemoTraeger(ctx, order.slug, traeger.ID))
	require.Error(t, schools.RecordDemoTraeger(ctx, order.slug, traeger.ID+1), "an order keeps the Träger it named")
	require.NoError(t, schools.RecordDemoSchool(ctx, order.slug, neighbour))

	// The visitor in the office, with a name the ledger recorded; a
	// colleague of the office who is no visitor; sessions everywhere.
	visitor := order.accounts.caregiver
	_, err = db.NewRaw(`INSERT INTO platform.organization_accounts (organization_id, account_id, status, activated_at, display_name)
		VALUES (?, ?, 'active', NOW(), ?)`, traeger.ID, visitor, visitorFull).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw(`INSERT INTO auth.organization_account_roles (organization_id, account_id, role) VALUES (?, ?, 'administration')`, traeger.ID, visitor).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw(`INSERT INTO audit.traeger_account_changes (organization_id, actor_account_id, action, target_account_id, target_name)
		VALUES (?, ?, 'name_changed', ?, ?)`, traeger.ID, visitor, visitor, visitorFull).Exec(ctx)
	require.NoError(t, err)
	colleague := testpkg.CreateTestAccount(t, db, "traeger-kollegin")
	testpkg.CreateTestTraegerMember(t, db, traeger.ID, colleague.ID, "billing")
	for _, statement := range []string{
		`INSERT INTO auth.tokens (account_id, token, expiry, organization_id, portal_scope)
			VALUES (?0, encode(sha256(convert_to('org-' || ?0::text, 'UTF8')), 'hex'), NOW() + INTERVAL '1 day', ?1, 'org')`,
		`INSERT INTO auth.tokens (account_id, token, expiry, tenant_id, organization_id, portal_scope)
			VALUES (?0, encode(sha256(convert_to('absprung-' || ?0::text, 'UTF8')), 'hex'), NOW() + INTERVAL '1 day', ?2, ?1, 'tenant')`,
	} {
		for _, account := range []int64{visitor, colleague.ID} {
			_, err := db.NewRaw(statement, account, traeger.ID, neighbour).Exec(ctx)
			require.NoError(t, err, statement)
		}
	}

	hidden, erased := retireAtLeast(t, db, order.queue, []string{order.slug}, 2, 1)

	assert.Equal(t, 2, hidden, "the visitor's school and its neighbour")
	assert.Equal(t, 1, erased)
	assert.True(t, schoolHidden(t, db, order.schoolID))
	assert.True(t, schoolHidden(t, db, neighbour))
	assert.False(t, schoolHidden(t, db, order.realID), "a school of another Träger stays")
	count := func(query string, args ...any) int {
		t.Helper()
		var n int
		require.NoError(t, db.NewRaw(query, args...).Scan(ctx, &n))
		return n
	}
	assert.Zero(t, count(`SELECT count(*) FROM auth.tokens WHERE organization_id = ? OR tenant_id = ?`, traeger.ID, neighbour), "no session of the Träger or a neighbour school is left")
	assert.Zero(t, count(`SELECT count(*) FROM platform.organization_accounts WHERE organization_id = ? AND account_id = ?`, traeger.ID, visitor))
	assert.Zero(t, count(`SELECT count(*) FROM auth.organization_account_roles WHERE organization_id = ? AND account_id = ?`, traeger.ID, visitor))
	assert.Zero(t, count(`SELECT count(*) FROM audit.traeger_account_changes WHERE organization_id = ? AND target_name = ?`, traeger.ID, visitorFull), "the ledger names the visitor no more")
	assert.Equal(t, 1, count(`SELECT count(*) FROM platform.organization_accounts WHERE organization_id = ? AND account_id = ?`, traeger.ID, colleague.ID), "a colleague of the office is no visitor")
	assert.Equal(t, 1, count(`SELECT count(*) FROM auth.accounts WHERE id = ? AND personal_data_erased_at IS NOT NULL`, visitor), "the visitor's account is erased like any visitor account")
	assert.Equal(t, 1, count(`SELECT count(*) FROM platform.demo_traeger_origins WHERE organization_id = ? AND erased_at IS NULL`, traeger.ID))
	assert.Equal(t, 1, count(`SELECT count(*) FROM platform.demo_school_origins WHERE school_id = ?`, neighbour), "the neighbour school is a demo school for the file and database erasure")
	assert.Equal(t, 1, count(`SELECT count(*) FROM platform.organizations WHERE id = ?`, traeger.ID), "the Träger waits for its schools")
	assert.Equal(t, 1, count(`SELECT count(*) FROM platform.organizations WHERE id = ? AND NOT active`, traeger.ID),
		"out of service: no Träger session is minted or validated for it any more")
}

// A restart of an order with a Träger of its own (#3470, ADR 0271) hides the
// neighbour schools with the visitor's school and ends every session of the
// Träger and of its schools first, inside the serving backend's
// administrative transaction and with its restricted role.
func TestDemoSchoolOrdersRetireTheOwnTraegerForARestart(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	traeger := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Ganztag Nord e. V.", Slug: "traeger-restart"})
	schoolID := testpkg.CreateTestSchoolInOrganization(t, db, traeger.ID, "OGS Nord")
	neighbour := testpkg.CreateTestSchoolInOrganization(t, db, traeger.ID, "OGS Rheinblick")
	other, _ := testpkg.CreateTestTenant(t, db)
	queue, err := NewDemoSchoolQueue(db)
	require.NoError(t, err)
	schools, err := NewDemoSchools(db)
	require.NoError(t, err)
	slug := readyDemoSchool(t, db, queue, schools, "OGS Nord", schoolID)
	require.NoError(t, schools.RecordDemoTraeger(ctx, slug, traeger.ID))
	member := testpkg.CreateTestAccount(t, db, "demo-traeger-neustart")
	testpkg.CreateTestTraegerMember(t, db, traeger.ID, member.ID, "administration")
	_, err = db.NewRaw(`INSERT INTO auth.tokens (account_id, token, expiry, organization_id, portal_scope)
		VALUES (?, encode(sha256('restart-org-session'::bytea), 'hex'), NOW() + INTERVAL '1 day', ?, 'org')`, member.ID, traeger.ID).Exec(ctx)
	require.NoError(t, err)
	testpkg.CreateTestSessionFamily(t, db, member.ID, neighbour, "")
	testpkg.CreateTestSessionFamily(t, db, member.ID, other, "")
	orders := NewDemoSchoolOrders(strings.NewReader("k3m9xp"), testDemoCapacity)

	require.NoError(t, testpkg.WithinAdminContext(t, ctx, db, func(ctx context.Context) error {
		return orders.RetireDemoSchool(ctx, slug)
	}))

	assert.True(t, schoolHidden(t, db, schoolID))
	assert.True(t, schoolHidden(t, db, neighbour))
	assert.False(t, schoolHidden(t, db, other))
	var left, elsewhere int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.tokens WHERE organization_id = ? OR tenant_id IN (?, ?)`, traeger.ID, schoolID, neighbour).Scan(ctx, &left))
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.tokens WHERE tenant_id = ?`, other).Scan(ctx, &elsewhere))
	assert.Zero(t, left, "no session of the Träger or its schools is left")
	assert.Equal(t, 1, elsewhere, "a session at a school of another Träger stays")
	var active bool
	require.NoError(t, db.NewRaw(`SELECT active FROM platform.organizations WHERE id = ?`, traeger.ID).Scan(ctx, &active))
	assert.False(t, active, "out of service: a redemption racing the restart mints no Träger session")
}

// A deferred seed can fail after the school opened and visitors entered it
// (RequeueDeferred). The final failure takes the order's own Träger out of
// service and ends its sessions, run by the demo process's restricted role.
func TestFinalFailureTakesTheOwnTraegerOutOfService(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	traeger := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Ganztag Nord e. V.", Slug: "traeger-failed"})
	schoolID := testpkg.CreateTestSchoolInOrganization(t, db, traeger.ID, "OGS Nord")
	demoDB := testpkg.DemoRoleDatabase(t, db)
	queue, err := NewDemoSchoolQueue(demoDB)
	require.NoError(t, err)
	schools, err := NewDemoSchools(demoDB)
	require.NoError(t, err)

	slug := orderDemoSchool(t, db, "OGS Nord")
	_, err = queue.ClaimDemoSchoolOrder(ctx)
	require.NoError(t, err)
	require.NoError(t, schools.RecordDemoTraeger(ctx, slug, traeger.ID))
	require.NoError(t, schools.RememberDemoSchool(ctx, slug, organizationtenancy.DemoSchoolState{
		SchoolID: schoolID, SeedJSON: []byte(`{"deferred_seed_pending":true}`),
	}))
	require.NoError(t, queue.FinishDemoSchoolOrder(ctx, slug, 0, 0))
	visitor := testpkg.CreateTestAccount(t, db, "demo-traeger-besuch")
	testpkg.CreateTestTraegerMember(t, db, traeger.ID, visitor.ID, "administration")
	_, err = db.NewRaw(`INSERT INTO auth.tokens (account_id, token, expiry, organization_id, portal_scope)
		VALUES (?, encode(sha256('failed-org-session'::bytea), 'hex'), NOW() + INTERVAL '1 day', ?, 'org')`, visitor.ID, traeger.ID).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, queue.RequeueDeferredDemoSchoolOrder(ctx, slug))
	_, err = queue.ClaimDemoSchoolOrder(ctx)
	require.NoError(t, err)
	failed, err := queue.FailDemoSchoolOrder(ctx, slug, 1)
	require.NoError(t, err)
	require.True(t, failed)

	assert.True(t, schoolHidden(t, db, schoolID))
	var sessions int
	var active bool
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.tokens WHERE organization_id = ?`, traeger.ID).Scan(ctx, &sessions))
	require.NoError(t, db.NewRaw(`SELECT active FROM platform.organizations WHERE id = ?`, traeger.ID).Scan(ctx, &active))
	assert.Zero(t, sessions, "the visitor's Träger session ends with the failed order")
	assert.False(t, active)
}
