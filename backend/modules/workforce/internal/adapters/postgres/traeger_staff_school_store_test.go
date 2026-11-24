package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A hold stamps the school's bank row past every link written before it, on
// the database clock that stamps linked_at: the next hand-over of the record
// tells the held row from one the link read by that order alone.
func TestHoldSchoolFinancialRowStampsTheRowAfterTheLink(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Mira", "Halt")
	ctx := testpkg.Ctx(t)
	_, err := db.ExecContext(ctx, `INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked) VALUES (?, ?, ?, ?)`,
		school, staff.ID, []byte("sealed"), "•••• 4711")
	require.NoError(t, err)
	var linkedAt time.Time
	require.NoError(t, db.NewRaw(`SELECT now()`).Scan(ctx, &linkedAt))

	store := NewTraegerStaffStore()
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		return store.HoldSchoolFinancialRow(ctx, staff.ID)
	}))
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		rows, err := store.SchoolFinancialRows(ctx, []int64{staff.ID})
		require.NoError(t, err)
		require.Len(t, rows, 1)
		require.True(t, rows[0].UpdatedAt.After(linkedAt), "held at %s, linked at %s", rows[0].UpdatedAt, linkedAt)
		return nil
	}))
}

// A rekey rewraps the sealed values without stamping the row: a row from
// before a link stays older than the link, so the next hand-over still moves
// it to the record instead of keeping it as one a link held back.
func TestBankRekeyKeepsTheRowsTimestamp(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Mira", "Rekey")
	ctx := testpkg.Ctx(t)
	var before time.Time
	require.NoError(t, db.NewRaw(`INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked, updated_at)
		VALUES (?, ?, ?, ?, now() - interval '1 hour') RETURNING updated_at`, school, staff.ID, []byte("sealed-old"), "•••• 4711").Scan(ctx, &before))

	var result struct{ changed int }
	require.NoError(t, testpkg.WithTenantTx(t, ctx, db, school, func(txCtx context.Context, _ bun.Tx) error {
		rewritten, err := NewStaffBankRekeyStore().RewriteStaffBankData(txCtx, school, 0, 10, func(row *domain.StaffFinancialData) (bool, error) {
			row.IBANSealed = []byte("sealed-new")
			return true, nil
		})
		result.changed = rewritten.Changed
		return err
	}))
	require.Equal(t, 1, result.changed)

	var after time.Time
	var sealed []byte
	require.NoError(t, db.NewRaw(`SELECT updated_at, iban_sealed FROM users.staff_financial_data WHERE staff_id = ?`, staff.ID).Scan(ctx, &after, &sealed))
	require.Equal(t, []byte("sealed-new"), sealed)
	require.True(t, after.Equal(before), "rekeyed at %s, written at %s", after, before)
}

// A dissolution reads when the Personalverwaltung last changed a bank or
// tax field (#8029), to tell a value it entered after a school's hold from
// one the school kept. The hold writes its own trail entries right after it
// commits (not_chosen, one per kept value): those are no change of the
// record and must not count, or every held value would lose to the record.
func TestFinancialChangeTimesIgnoreTheEntriesOfAHold(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Mira", "Verlauf")
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Verlauf", Slug: fmt.Sprintf("financial-trail-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	ctx := testpkg.Ctx(t)
	traeger := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	_, err := db.ExecContext(ctx, `INSERT INTO workforce.staff_releases (organization_id, representation, released_by_operator_id) VALUES (?, 'none', 1)`, organization)
	require.NoError(t, err)
	var record int64
	require.NoError(t, db.NewRaw(`INSERT INTO workforce.staff_records (organization_id, first_name, last_name) VALUES (?, 'Mira', 'Verlauf') RETURNING id`, organization).Scan(ctx, &record))
	_, err = db.ExecContext(ctx, `INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked, tax_id_sealed) VALUES (?, ?, ?, ?, ?)`,
		school, staff.ID, []byte("sealed-iban"), "•••• 4711", []byte("sealed-tax"))
	require.NoError(t, err)

	store := NewTraegerStaffStore()
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		return store.HoldSchoolFinancialRow(ctx, staff.ID)
	}))
	appendTrail := func(changes ...domain.TraegerStaffChange) {
		require.NoError(t, testpkg.WithinTraeger(traeger, organization, func(ctx context.Context) error {
			return store.AppendStaffChanges(ctx, organization, changes)
		}))
	}
	// The hold's entries, as the link writes them after the school committed.
	appendTrail(
		domain.TraegerStaffChange{RecordID: record, Kind: domain.StaffChangeNotChosen, Field: domain.StaffFieldIBAN, ValueMasked: new("•••• 4711"), SchoolID: &school, AccountID: 9},
		domain.TraegerStaffChange{RecordID: record, Kind: domain.StaffChangeNotChosen, Field: domain.StaffFieldTaxID, ValueMasked: new("•••"), SchoolID: &school, AccountID: 9},
	)
	// Then the Personalverwaltung changes the IBAN.
	appendTrail(domain.TraegerStaffChange{RecordID: record, Kind: domain.StaffChangeChanged, Field: domain.StaffFieldIBAN, ValueMasked: new(""), AccountID: 9})

	var heldAt time.Time
	require.NoError(t, db.NewRaw(`SELECT updated_at FROM users.staff_financial_data WHERE staff_id = ?`, staff.ID).Scan(ctx, &heldAt))
	var changedAt map[string]time.Time
	require.NoError(t, testpkg.WithinTraeger(traeger, organization, func(ctx context.Context) error {
		changedAt, err = store.FinancialChangeTimes(ctx, organization, record)
		return err
	}))
	require.Contains(t, changedAt, domain.StaffFieldIBAN)
	require.True(t, changedAt[domain.StaffFieldIBAN].After(heldAt), "changed at %s, held at %s", changedAt[domain.StaffFieldIBAN], heldAt)
	require.NotContains(t, changedAt, domain.StaffFieldTaxID, "the hold's entry is no change of the tax ID")
}
