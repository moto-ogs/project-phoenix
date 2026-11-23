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

// TestCareContractApplicationBindingKeepsItsShape pins 20261122202100 (#7760)
// under the request role: it binds an imported contract to an application
// child, the trail records it, one application child still has one contract
// at a school, a contract still needs an origin, and the trail still refuses
// an action it does not know.
func TestCareContractApplicationBindingKeepsItsShape(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Bindung", Slug: fmt.Sprintf("traeger-bindung-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, db, organization)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "Bindung OGS")
	imported := func(origin string) int64 {
		var id int64
		require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contracts (organization_id, school_id, import_origin, student_id, status, sent_at)
			VALUES (?, ?, ?, 4711, 'versendet', NOW()) RETURNING id`, organization, school, origin).Scan(ctx, &id))
		return id
	}
	contract, second := imported("mia|beispiel|2018-03-04|2026-08-01"), imported("ole|beispiel|2017-05-06|2026-08-01")
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
	bind := func(id, requestChild int64) string {
		return fmt.Sprintf(`UPDATE care_contract.contracts SET request_child_id = %d WHERE id = %d`, requestChild, id)
	}
	event := func(action string) string {
		return fmt.Sprintf(`INSERT INTO care_contract.contract_events (organization_id, contract_id, school_id, action)
			VALUES (%d, %d, %d, '%s')`, organization, contract, school, action)
	}
	require.NoError(t, as(bind(contract, 815)), "the request role binds the imported contract")
	require.NoError(t, as(event("bind_application")), "the trail records the binding")
	require.NoError(t, as(event("unlink_child")), "the links of imported contracts (20261122150000) stay recordable")
	assert.ErrorContains(t, as(bind(second, 815)), "uq_contracts_application", "one application child has one contract at a school")
	assert.ErrorContains(t, as(fmt.Sprintf(`INSERT INTO care_contract.contracts (organization_id, school_id) VALUES (%d, %d)`,
		organization, school)), "chk_contracts_origin", "a contract without an origin stays refused")
	assert.ErrorContains(t, as(event("rebind")), "chk_contract_events_action", "an unknown action stays refused")
}
