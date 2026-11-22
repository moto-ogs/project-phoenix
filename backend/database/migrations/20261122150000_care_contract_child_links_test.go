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

// TestCareContractChildLinksKeepTheirShape pins 20261122150000 (#7760) under
// the request role: it links an imported contract to a child record and
// unlinks it, the trail records both, and the trail still refuses an action
// it does not know.
func TestCareContractChildLinksKeepTheirShape(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Verknüpfung", Slug: fmt.Sprintf("traeger-verknuepfung-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, db, organization)
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "Verknüpfung OGS")
	var contract int64
	require.NoError(t, db.NewRaw(`INSERT INTO care_contract.contracts (organization_id, school_id, import_origin, status, sent_at)
		VALUES (?, ?, 'mia|beispiel|2018-03-04|2026-08-01', 'versendet', NOW()) RETURNING id`, organization, school).Scan(ctx, &contract))
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
	event := func(action string) string {
		return fmt.Sprintf(`INSERT INTO care_contract.contract_events (organization_id, contract_id, school_id, action)
			VALUES (%d, %d, %d, '%s')`, organization, contract, school, action)
	}
	require.NoError(t, as(fmt.Sprintf(`UPDATE care_contract.contracts SET student_id = 4711 WHERE id = %d`, contract)),
		"the request role links the contract")
	require.NoError(t, as(event("link_child")), "the trail records the link")
	require.NoError(t, as(fmt.Sprintf(`UPDATE care_contract.contracts SET student_id = NULL WHERE id = %d`, contract)),
		"the request role unlinks the contract")
	require.NoError(t, as(event("unlink_child")), "the trail records the removal")
	require.NoError(t, as(event("correct")), "the corrections of imported contracts (#7767) stay recordable")
	assert.ErrorContains(t, as(event("relink_child")), "chk_contract_events_action", "an unknown action stays refused")
}
