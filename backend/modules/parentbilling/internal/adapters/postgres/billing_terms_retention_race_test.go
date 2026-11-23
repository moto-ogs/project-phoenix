package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A write of the office that names a contract the hourly retention is
// deleting (#7964). The retention locks the due contract (FOR UPDATE in
// due_retained_contracts), moves the deviation onto the family's remaining
// contract (MoveFamilies) and deletes the old one, all in one transaction.
// A write that still names the old contract waits for that transaction and
// must not fail with a foreign key violation (a 500) once it commits.

// retentionRace is one Träger with an ended contract the retention deletes
// and the family's running contract.
type retentionRace struct {
	organization, going, staying int64
	family                       string
}

func newRetentionRace(t *testing.T, db *bun.DB) retentionRace {
	t.Helper()
	unique := testpkg.UniqueTestTenantID(t)
	race := retentionRace{family: fmt.Sprintf("familie.%d@example.org", unique)}
	race.organization = testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger im Lauf", Slug: fmt.Sprintf("retention-race-%d", unique),
	}).ID
	school := testpkg.CreateTestSchoolInOrganization(t, db, race.organization, "Lauf OGS")
	race.going = testpkg.CreateTestCareContract(t, db, race.organization, school, testpkg.UniqueTestTenantID(t), "versendet", calendar.NewDate(2026, time.August, 1))
	race.staying = testpkg.CreateTestCareContract(t, db, race.organization, school, testpkg.UniqueTestTenantID(t), "versendet", calendar.NewDate(2026, time.August, 1))
	return race
}

// runRetention starts the retention's transaction on the contract that goes:
// it locks the contract, moves the deviation (if any) onto the staying one
// and deletes the old contract, then waits for commit.
func (r retentionRace) runRetention(t *testing.T, ctx context.Context, db *bun.DB, deviation int64) bun.Tx {
	t.Helper()
	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	_, err = tx.ExecContext(ctx, `SELECT id FROM care_contract.contracts WHERE id = ? FOR UPDATE`, r.going)
	require.NoError(t, err)
	if deviation > 0 {
		_, err = tx.ExecContext(ctx, `UPDATE parent_billing.family_billing SET care_contract_id = ? WHERE id = ? AND care_contract_id = ?`,
			r.staying, deviation, r.going)
		require.NoError(t, err)
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM care_contract.contracts WHERE id = ?`, r.going)
	require.NoError(t, err)
	return tx
}

// officeWrite runs write in the Träger transaction while the retention
// holds its locks, waits until the write blocks on them, commits the
// retention and answers the write's result.
func officeWrite(t *testing.T, db *bun.DB, organization int64, retention bun.Tx, write func(context.Context) error) error {
	t.Helper()
	pid := make(chan int64, 1)
	done := make(chan error, 1)
	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	go func() {
		done <- testpkg.WithinTraeger(ctx, organization, func(ctx context.Context) error {
			tx, err := traegerDB(ctx, organization)
			if err != nil {
				pid <- 0
				return err
			}
			var backend int64
			if err := tx.NewRaw(`SELECT pg_backend_pid()`).Scan(ctx, &backend); err != nil {
				pid <- 0
				return err
			}
			pid <- backend
			return write(ctx)
		})
	}()
	backend := <-pid
	require.NotZero(t, backend)
	require.Eventually(t, func() bool {
		var waiting bool
		require.NoError(t, db.NewRaw(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ? AND wait_event_type = 'Lock')`, backend).
			Scan(context.Background(), &waiting))
		return waiting
	}, 10*time.Second, 5*time.Millisecond, "the office write waits for the retention")
	require.NoError(t, retention.Commit())
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("the office write still waits after the retention committed")
		return nil
	}
}

// TestTrailEntryDuringTheRetentionNamesTheContractThatStays: the office
// opened the family (an unlocked read of the deviation on the old contract)
// while the retention moves it. Its read entry waits for the retention and
// then names the contract the deviation hangs on now.
func TestTrailEntryDuringTheRetentionNamesTheContractThatStays(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	race := newRetentionRace(t, db)
	var deviation int64
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.family_billing (organization_id, family_email, care_contract_id,
			recipient_kind, payment_method) VALUES (?, ?, ?, 'applicant', 'direct_debit') RETURNING id`,
		race.organization, race.family, race.going).Scan(ctx, &deviation))
	read := parentbilling.FamilyBilling{ID: ident.ID(deviation), FamilyEmail: race.family, ContractID: ident.ID(race.going)}

	retention := race.runRetention(t, ctx, db, deviation)
	err := officeWrite(t, db, race.organization, retention, func(ctx context.Context) error {
		return NewStore(time.Now).InsertFamilyBillingEvents(ctx, race.organization, 0, "read", []parentbilling.FamilyBilling{read})
	})
	require.NoError(t, err, "the read entry must not fail on the deleted contract")

	var contracts []int64
	require.NoError(t, db.NewRaw(`SELECT care_contract_id FROM parent_billing.family_billing_events
		WHERE organization_id = ? AND family_billing_id = ? AND action = 'read'`, race.organization, deviation).Scan(ctx, &contracts))
	assert.Equal(t, []int64{race.staying}, contracts, "the entry names the contract the deviation hangs on now")
}

// TestSaveThroughAContractTheRetentionDeletesIsAConflict: the office saves
// a first deviation through the contract the retention deletes. The save
// cannot bind the deviation to it; it answers that the state it read has
// changed instead of failing on the foreign key.
func TestSaveThroughAContractTheRetentionDeletesIsAConflict(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	race := newRetentionRace(t, db)

	retention := race.runRetention(t, ctx, db, 0)
	err := officeWrite(t, db, race.organization, retention, func(ctx context.Context) error {
		_, err := NewStore(time.Now).SaveFamilyBilling(ctx, race.organization, 0, parentbilling.FamilyBilling{
			FamilyEmail: race.family, ContractID: ident.ID(race.going), RecipientKind: parentbilling.RecipientApplicant,
			PaymentMethod: parentbilling.PaymentMethods[0],
		})
		return err
	})
	require.ErrorIs(t, err, readstate.ErrChanged)

	var rows int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM parent_billing.family_billing WHERE organization_id = ?`, race.organization).Scan(ctx, &rows))
	assert.Zero(t, rows, "nothing was saved")
}
