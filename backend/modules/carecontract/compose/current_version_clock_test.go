package compose_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/uptrace/bun"
)

// The current version of a contract is the one in force on the Berlin day
// of the owner's clock (#7295), not of the database's: with the owner clock
// in March 2100, the version effective from 1 March 2100 is current in the
// detail and in the list, while the database clock still reads the first.
func TestCurrentVersionIsPickedOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, db))
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Uhr", Slug: fmt.Sprintf("traeger-uhr-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	testpkg.OwnTraegerCareContracts(t, db, organization)
	account := testpkg.CreateTestAccountWithPassword(t, db, fmt.Sprintf("uhr-%d@test.local", testpkg.UniqueTestTenantID(t)), testpkg.NewTestPassword())
	reviewer := carecontract.Reviewer{OrganizationID: organization, AccountID: account.ID}
	school := changedSchool{school: carecontract.School{ID: testpkg.UniqueTestTenantID(t), Name: "OGS Am Lindenhof"},
		child: testpkg.UniqueTestTenantID(t), offering: testpkg.UniqueTestTenantID(t)}
	contract := activeContract(t, ctx, organization, school)
	require.NoError(t, db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE care_contract.contract_versions SET status = 'abgeloest'
			WHERE organization_id = ? AND contract_id = ?`, organization, contract); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO care_contract.contract_versions (organization_id, contract_id, version_number,
				status, effective_from, child_first_name, child_last_name, school_name, term_kind, notice_months, notice_to,
				special_termination, special_termination_note, statute_required, statute_title, statute_url, contract_partner, source)
			VALUES (?, ?, 2, 'wirksam', '2100-03-01', 'Lina', 'Muster', 'OGS Am Lindenhof', 'open_ended', 1, 'month_end',
				false, '', false, '', '', '', 'buchungsaenderung')`, organization, contract)
		return err
	}))

	march := time.Date(2100, time.March, 2, 12, 0, 0, 0, calendar.Berlin)
	contracts := compose.NewContracts(compose.ContractPorts{Holidays: holidaysDouble{}, Letterheads: letterheadDouble{}, Post: &postDouble{},
		Runtime: runtimeDouble{}, Access: school, Ledger: ledgerDouble{}, Links: testSigningLinks()}, func() time.Time { return march })
	detail, err := contracts.Contract(ctx, reviewer, contract)
	require.NoError(t, err)
	assert.Equal(t, 2, detail.Version.Number, "on 2 March 2100 the second version is in force")
	assert.Equal(t, calendar.NewDate(2100, 3, 1), detail.EffectiveFrom, "the detail's summary reads the same version")
	list, err := contracts.ListContracts(ctx, reviewer, carecontract.ContractFilter{Limit: 10})
	require.NoError(t, err)
	require.Len(t, list.Contracts, 1)
	assert.Equal(t, calendar.NewDate(2100, 3, 1), list.Contracts[0].EffectiveFrom, "the list shows the version in force")
}
