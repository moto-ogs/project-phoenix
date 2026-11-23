package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestCareContractApplicationUnbindingKeepsItsShape pins 20261123090000
// (#7760) under the request role: an imported contract is bound and unbound
// again and the trail records the way back; a bound contract is not moved to
// another application child in one step, and the application child of a
// contract from an application never changes. An insert is not guarded: a
// contract with one origin is created as before, from an application or
// imported, and one with both origins is inserted as it stands, so a
// restore keeps a bound contract.
func TestCareContractApplicationUnbindingKeepsItsShape(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Lösen", Slug: fmt.Sprintf("traeger-loesen-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, db, organization)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "Lösen OGS")
	var imported, applied int64
	require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contracts (organization_id, school_id, import_origin, student_id, status, sent_at)
		VALUES (?, ?, 'mia|beispiel|2018-03-04|2026-08-01', 4711, 'versendet', NOW()) RETURNING id`, organization, school).Scan(ctx, &imported))
	require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contracts (organization_id, school_id, request_child_id, status)
		VALUES (?, ?, 900, 'entwurf') RETURNING id`, organization, school).Scan(ctx, &applied))
	as := func(statement string) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `SET LOCAL ROLE phoenix_tenant`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_org_id', ?, true)`, fmt.Sprint(organization)); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, statement)
			return err
		})
	}
	set := func(id int64, requestChild string) string {
		return fmt.Sprintf(`UPDATE care_contract.contracts SET request_child_id = %s WHERE id = %d`, requestChild, id)
	}
	require.NoError(t, as(set(imported, "815")), "the request role binds the imported contract")
	assert.ErrorContains(t, as(set(imported, "816")), "unbound before it is bound", "a bound contract is not moved in one step")
	require.NoError(t, as(set(imported, "815")), "writing the same application child changes nothing")
	require.NoError(t, as(set(imported, "NULL")), "the request role unbinds it again")
	require.NoError(t, as(fmt.Sprintf(`INSERT INTO care_contract.contract_events (organization_id, contract_id, school_id, action)
		VALUES (%d, %d, %d, 'unbind')`, organization, imported, school)), "the trail records the way back")
	require.NoError(t, as(set(imported, "816")), "an unbound contract is bound to another application child")
	assert.ErrorContains(t, as(set(applied, "901")), "does not change",
		"the application child of a contract from an application never changes")

	insert := func(origins, values string) string {
		return fmt.Sprintf(`INSERT INTO care_contract.contracts (organization_id, school_id, status, %s) VALUES (%d, %d, 'entwurf', %s)`,
			origins, organization, school, values)
	}
	require.NoError(t, as(insert(`request_child_id`, `902`)), "a contract from an application is created as before")
	require.NoError(t, as(insert(`import_origin`, `'ben|beispiel|2018-03-04|2026-08-01'`)), "and so is an imported one")
	require.NoError(t, as(insert(`import_origin, request_child_id`, `'lea|beispiel|2018-03-04|2026-08-01', 903`)),
		"a bound imported contract is inserted with both origins")
}
