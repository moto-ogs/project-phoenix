package owners

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
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// belegFixture is one Träger with a holiday invoice of 2026 and its
// cancellation of 2027, a monthly invoice of 2026 collected by SEPA debit
// on a mandate of an ended contract.
type belegFixture struct {
	organization, holidayRun, invoice, cancellation, careInvoice, debit, mandate, contract int64
}

func newBelegFixture(t *testing.T, db *bun.DB, name string) belegFixture {
	t.Helper()
	ctx := context.Background()
	f := belegFixture{}
	f.organization = testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: name, Slug: fmt.Sprintf("beleg-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	school := testpkg.CreateTestSchoolInOrganization(t, db, f.organization, name+" OGS")
	f.contract = testpkg.CreateTestCareContract(t, db, f.organization, school, testpkg.UniqueTestTenantID(t), "versendet", calendar.NewDate(2026, time.August, 1))
	_, err := db.ExecContext(ctx, `UPDATE care_contract.contracts SET concluded_at = '2026-08-01 10:00+02', conclusion_method = 'papier',
		status = 'gekuendigt', ends_on = '2027-07-31' WHERE id = ?`, f.contract)
	require.NoError(t, err)

	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.runs (organization_id, service, holiday_period_id, period_name, service_from,
			service_until, status, released_at, issued_on, document_count, total_cents)
		VALUES (?, 'holiday', ?, 'Sommerferien', '2026-07-06', '2026-07-10', 'released', NOW(), '2026-06-01', 2, 0) RETURNING id`,
		f.organization, testpkg.UniqueTestTenantID(t)).Scan(ctx, &f.holidayRun))
	document := func(number, issued, kind string, reference *int64, total int) int64 {
		var id int64
		require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.documents (organization_id, run_id, service, number, number_year,
				number_sequence, issued_on, holiday_period_id, holiday_registration_id, recipient_first_name, recipient_last_name,
				recipient_email, service_from, service_until, total_cents, kind, reference_document_id, reason)
			VALUES (?, ?, 'holiday', ?, 0, ?, ?, 1, 2, 'Eva', 'Muster', 'eva@example.org', '2026-07-06', '2026-07-10', ?, ?, ?, ?) RETURNING id`,
			f.organization, f.holidayRun, number, testpkg.UniqueTestTenantID(t), issued, total, kind, reference,
			map[bool]string{true: "Storno", false: ""}[reference != nil]).Scan(ctx, &id))
		return id
	}
	f.invoice = document("FE-1", "2026-06-01", "invoice", nil, 4500)
	f.cancellation = document("FE-2", "2027-02-01", "cancellation", &f.invoice, -4500)

	var careRun int64
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.care_runs (organization_id, billing_month, status, released_at, issued_on,
			document_count, total_cents, month_rule) VALUES (?, DATE '2026-10-01', 'released', NOW(), DATE '2026-10-30', 1, 3700, 'version_on_first')
		RETURNING id`, f.organization).Scan(ctx, &careRun))
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.care_invoices (organization_id, run_id, number, number_year, number_sequence,
			issued_on, billing_month, care_contract_id, school_id, school_name, child_first_name, child_last_name, recipient_first_name,
			recipient_last_name, recipient_email, month_rule, total_cents)
		VALUES (?, ?, 'MB-1', 2026, 1, DATE '2026-10-30', DATE '2026-10-01', ?, ?, 'OGS', 'Mia', 'Muster', 'Eva', 'Muster', '',
			'version_on_first', 3700) RETURNING id`, f.organization, careRun, f.contract, school).Scan(ctx, &f.careInvoice))
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.sepa_mandates (organization_id, family_email, care_contract_id, reference,
			signed_on, kind, sequence, creditor_id, account_holder_sealed, iban_sealed, iban_masked, source)
		VALUES (?, 'eva@example.org', ?, ?, '2026-09-01', 'recurring', 'first', 'DE98ZZZ09999999999', '\x01'::bytea, '\x02'::bytea, 'DE••', 'office')
		RETURNING id`, f.organization, f.contract, fmt.Sprintf("M-%d", testpkg.UniqueTestTenantID(t))).Scan(ctx, &f.mandate))
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.sepa_debits (organization_id, mandate_id, care_contract_id, run_kind, run_id,
			care_invoice_id, invoice_number, amount_cents, due_on, sequence_type, creditor_id, mandate_reference, mandate_signed_on,
			account_holder_sealed, iban_sealed, status, message_id, submitted_at, submitted_amount_cents, collect_on)
		VALUES (?, ?, ?, 'care', ?, ?, 'MB-1', 3700, '2026-11-13', 'FRST', 'DE98ZZZ09999999999', 'M', '2026-09-01',
			'\x01'::bytea, '\x02'::bytea, 'submitted', 'MSG-1', '2026-11-10 09:00+01', 3700, '2026-11-13') RETURNING id`,
		f.organization, f.mandate, f.contract, careRun, f.careInvoice).Scan(ctx, &f.debit))
	return f
}

func instruct(t *testing.T, retention parentbilling.BelegRetention, ctx context.Context, organization int64) {
	t.Helper()
	for _, instruction := range []parentbilling.NewRetentionInstruction{
		{BelegType: parentbilling.BelegHolidayDocument, TriggerEvent: parentbilling.TriggerIssued, Period: 8, Basis: parentbilling.BasisBookingVoucher},
		{BelegType: parentbilling.BelegCareInvoice, TriggerEvent: parentbilling.TriggerIssued, Period: 8, Basis: parentbilling.BasisBookingVoucher},
		{BelegType: parentbilling.BelegSEPADebit, TriggerEvent: parentbilling.TriggerIssued, Period: 8, Basis: parentbilling.BasisBookingVoucher},
		{BelegType: parentbilling.BelegSEPAMandate, TriggerEvent: parentbilling.TriggerLastCollection, Period: 14, Basis: parentbilling.BasisCollectionAgreement},
		{BelegType: parentbilling.BelegCareContract, TriggerEvent: parentbilling.TriggerContractEnded, Period: 6, Basis: parentbilling.BasisBusinessLetter},
	} {
		instruction.LegalBasis, instruction.InstructedBy = "§ 147 AO", "Kämmerei des Trägers"
		instruction.InstructedOn, instruction.InstructionReference = calendar.NewDate(2026, time.November, 9), "AVV-Nachtrag 2026-11"
		_, err := retention.RecordInstruction(ctx, organization, 0, instruction)
		require.NoError(t, err, instruction.BelegType)
	}
}

// TestBelegRetentionDeletesOnlyInstructedBelegeAfterTheirPeriod runs the
// hourly job across the turn of 2034/2035 with a test clock (#4720):
// without an instruction nothing goes and the Beleg waits on the
// clarification list; with one, a Beleg of 2026 goes on 1 January 2035,
// unless a later cancellation still keeps it. Every deletion is logged
// without content, and the records of deleted Belege go with them.
func TestBelegRetentionDeletesOnlyInstructedBelegeAfterTheirPeriod(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	instructed := newBelegFixture(t, db, "Träger mit Weisung")
	open := newBelegFixture(t, db, "Träger ohne Weisung")
	today := calendar.NewDate(2026, time.November, 9)
	retention := NewBelegRetention(func() time.Time { return today.BerlinMidnight() })
	admin := func(fn func(context.Context) error) {
		t.Helper()
		require.NoError(t, tenant.WithinAdmin(tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db)), fn))
	}
	run := func(day calendar.Date) int {
		t.Helper()
		today = day
		deleted := 0
		admin(func(adminCtx context.Context) error {
			var err error
			deleted, err = retention.ApplyBelegRetention(adminCtx)
			return err
		})
		return deleted
	}
	exists := func(table string, id int64) bool {
		var found bool
		require.NoError(t, db.NewRaw(`SELECT EXISTS (SELECT 1 FROM `+table+` WHERE id = ?)`, id).Scan(ctx, &found))
		return found
	}
	overview := func(organization int64) parentbilling.BelegRetentionOverview {
		var result parentbilling.BelegRetentionOverview
		admin(func(adminCtx context.Context) error {
			var err error
			result, err = retention.Overview(adminCtx, organization)
			return err
		})
		return result
	}

	assert.Zero(t, run(today), "production has no instruction: the job deletes nothing")
	listed := overview(instructed.organization)
	require.NotEmpty(t, listed.Clarifications, "every Beleg without instruction is on the clarification list")
	for _, entry := range listed.Clarifications {
		assert.Equal(t, today, entry.ListedOn)
		assert.Equal(t, today.AddDays(30), entry.ReviewOn, entry.BelegType)
		assert.Equal(t, parentbilling.ClarificationOwner, entry.Responsible)
	}

	admin(func(adminCtx context.Context) error {
		instruct(t, retention, adminCtx, instructed.organization)
		return nil
	})
	assert.Zero(t, run(calendar.NewDate(2034, time.December, 31)), "on the last day of 2034 every Beleg of 2026 is still kept")
	for table, id := range map[string]int64{"parent_billing.documents": instructed.invoice, "parent_billing.care_invoices": instructed.careInvoice,
		"parent_billing.sepa_debits": instructed.debit, "parent_billing.sepa_mandates": instructed.mandate, "care_contract.contracts": instructed.contract} {
		assert.True(t, exists(table, id), table)
	}

	deleted := run(calendar.NewDate(2035, time.January, 1))
	assert.False(t, exists("parent_billing.sepa_debits", instructed.debit), "the debit of 2026 goes")
	assert.False(t, exists("parent_billing.care_invoices", instructed.careInvoice), "the invoice of 2026 goes after its debit")
	assert.False(t, exists("parent_billing.sepa_mandates", instructed.mandate), "the expired mandate goes once its debits are gone")
	assert.False(t, exists("care_contract.contracts", instructed.contract), "the contract ended 2027 goes after six years")
	assert.True(t, exists("parent_billing.documents", instructed.invoice), "the cancellation of 2027 still keeps the invoice it refers to")
	assert.True(t, exists("parent_billing.documents", instructed.cancellation))
	assert.GreaterOrEqual(t, deleted, 4)
	for table, id := range map[string]int64{"parent_billing.documents": open.invoice, "parent_billing.care_invoices": open.careInvoice,
		"parent_billing.sepa_debits": open.debit, "parent_billing.sepa_mandates": open.mandate, "care_contract.contracts": open.contract} {
		assert.True(t, exists(table, id), "without instruction the other Träger keeps %s", table)
	}
	after := overview(instructed.organization)
	logged := map[string]int{}
	for _, entry := range after.Deletions {
		assert.Equal(t, calendar.NewDate(2035, time.January, 1), entry.DeletedOn)
		logged[entry.BelegType] += entry.Count
	}
	assert.Equal(t, map[string]int{parentbilling.BelegSEPADebit: 1, parentbilling.BelegCareInvoice: 1,
		parentbilling.BelegSEPAMandate: 1, parentbilling.BelegCareContract: 1}, logged, "the log counts per type, no content")
	var records int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM parent_billing.beleg_retentions WHERE organization_id = ? AND beleg_type <> 'holiday_document'`,
		instructed.organization).Scan(ctx, &records))
	assert.Zero(t, records, "the records of deleted Belege go with them")
	overdue := overview(open.organization)
	require.NotEmpty(t, overdue.Clarifications)
	assert.Positive(t, overdue.Clarifications[0].Overdue, "an unclarified Beleg past its review shows as escalation")

	run(calendar.NewDate(2036, time.January, 1))
	assert.False(t, exists("parent_billing.documents", instructed.cancellation), "the cancellation of 2027 goes in 2036")
	assert.False(t, exists("parent_billing.documents", instructed.invoice), "and with it the invoice")
	assert.False(t, exists("parent_billing.runs", instructed.holidayRun), "the emptied run goes with its letters")
	assert.True(t, exists("parent_billing.documents", open.invoice))
}

// TestBelegRetentionSuspensionHoldsTheDeletion: a suspended type stays
// although its period ended, and goes after the suspension is lifted.
func TestBelegRetentionSuspensionHoldsTheDeletion(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	f := newBelegFixture(t, db, "Träger mit Aussetzung")
	today := calendar.NewDate(2026, time.November, 9)
	retention := NewBelegRetention(func() time.Time { return today.BerlinMidnight() })
	admin := func(fn func(context.Context) error) {
		t.Helper()
		require.NoError(t, tenant.WithinAdmin(tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db)), fn))
	}
	var hold parentbilling.RetentionSuspension
	admin(func(adminCtx context.Context) error {
		instruct(t, retention, adminCtx, f.organization)
		var err error
		hold, err = retention.RecordSuspension(adminCtx, f.organization, 0, parentbilling.NewRetentionSuspension{
			BelegType: parentbilling.BelegSEPADebit, Reason: "Betriebsprüfung 2026", Scope: "alle Lastschriften",
			Responsible: "Kämmerei", ReviewOn: calendar.NewDate(2027, time.March, 1),
		})
		return err
	})
	today = calendar.NewDate(2035, time.January, 2)
	admin(func(adminCtx context.Context) error { _, err := retention.ApplyBelegRetention(adminCtx); return err })
	var debits, invoices int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM parent_billing.sepa_debits WHERE id = ?`, f.debit).Scan(ctx, &debits))
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM parent_billing.care_invoices WHERE id = ?`, f.careInvoice).Scan(ctx, &invoices))
	assert.Equal(t, 1, debits, "the suspended debit stays")
	assert.Equal(t, 1, invoices, "and keeps the invoice it would take along")

	admin(func(adminCtx context.Context) error {
		return retention.LiftSuspension(adminCtx, f.organization, hold.ID.Int64(), 0)
	})
	today = calendar.NewDate(2035, time.January, 3)
	admin(func(adminCtx context.Context) error { _, err := retention.ApplyBelegRetention(adminCtx); return err })
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM parent_billing.sepa_debits WHERE id = ?`, f.debit).Scan(ctx, &debits))
	assert.Zero(t, debits, "after the lift the debit goes")
}

// TestBelegRetentionRefusesTheTraegerTransaction: the request role neither
// reads nor writes the retention, and a Träger transaction cannot run it.
func TestBelegRetentionRefusesTheTraegerTransaction(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger Rolle", Slug: fmt.Sprintf("beleg-rolle-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	for _, table := range []string{"beleg_retention_instructions", "beleg_retention_suspensions", "beleg_retentions", "beleg_deletions"} {
		err := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `SET LOCAL ROLE phoenix_tenant`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_org_id', ?, true)`, fmt.Sprint(organization)); err != nil {
				return err
			}
			var rows int
			return tx.NewRaw(`SELECT count(*) FROM parent_billing.`+table).Scan(ctx, &rows)
		})
		assert.ErrorContains(t, err, "permission denied", table)
	}
	unit := tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db))
	err := tenant.WithinTraeger(unit, organization, func(traegerCtx context.Context) error {
		_, err := NewBelegRetention(time.Now).Overview(traegerCtx, organization)
		return err
	})
	assert.ErrorContains(t, err, "administrative transaction")
}

// TestPendingDebitGoesWithItsInvoice: a debit that was never submitted is
// no Beleg of its own and goes with its invoice once the invoice is due
// (loeschfristen.md: "nicht eingereichte Lastschriften gehen mit ihrer
// Rechnung"); it used to keep the invoice and its mandate forever. A
// submitted debit still follows its own Weisung and suspension.
func TestPendingDebitGoesWithItsInvoice(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	f := newBelegFixture(t, db, "Träger mit offener Lastschrift")
	var pendingInvoice, pendingDebit int64
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.care_invoices (organization_id, run_id, number, number_year, number_sequence,
			issued_on, billing_month, care_contract_id, school_id, school_name, child_first_name, child_last_name, recipient_first_name,
			recipient_last_name, recipient_email, month_rule, total_cents)
		SELECT organization_id, run_id, 'MB-2', 2026, 2, issued_on, DATE '2026-11-01', care_contract_id, school_id, school_name, child_first_name,
			child_last_name, recipient_first_name, recipient_last_name, recipient_email, month_rule, total_cents
		FROM parent_billing.care_invoices WHERE id = ? RETURNING id`, f.careInvoice).Scan(ctx, &pendingInvoice))
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.sepa_debits (organization_id, mandate_id, care_contract_id, run_kind, run_id,
			care_invoice_id, invoice_number, amount_cents, due_on, sequence_type, creditor_id, mandate_reference, mandate_signed_on,
			account_holder_sealed, iban_sealed)
		SELECT organization_id, mandate_id, care_contract_id, 'care', run_id, ?, 'MB-2', 3700, '2026-12-13', 'RCUR', creditor_id,
			mandate_reference, mandate_signed_on, account_holder_sealed, iban_sealed
		FROM parent_billing.sepa_debits WHERE id = ? RETURNING id`, pendingInvoice, f.debit).Scan(ctx, &pendingDebit))

	today := calendar.NewDate(2026, time.November, 9)
	retention := NewBelegRetention(func() time.Time { return today.BerlinMidnight() })
	admin := func(fn func(context.Context) error) {
		t.Helper()
		require.NoError(t, tenant.WithinAdmin(tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db)), fn))
	}
	admin(func(adminCtx context.Context) error {
		instruct(t, retention, adminCtx, f.organization)
		_, err := retention.RecordSuspension(adminCtx, f.organization, 0, parentbilling.NewRetentionSuspension{
			BelegType: parentbilling.BelegSEPADebit, BelegID: ident.ID(f.debit), Reason: "Rückfrage der Bank", Scope: "Lastschrift MB-1",
			Responsible: "Kämmerei", ReviewOn: calendar.NewDate(2036, time.March, 1),
		})
		return err
	})
	today = calendar.NewDate(2035, time.January, 1)
	admin(func(adminCtx context.Context) error { _, err := retention.ApplyBelegRetention(adminCtx); return err })

	assert.False(t, belegExists(t, db, "parent_billing.care_invoices", pendingInvoice), "the invoice of 2026 goes in 2035")
	assert.False(t, belegExists(t, db, "parent_billing.sepa_debits", pendingDebit), "with its debit that was never submitted")
	assert.True(t, belegExists(t, db, "parent_billing.sepa_debits", f.debit), "the suspended submitted debit follows its own rule")
	assert.True(t, belegExists(t, db, "parent_billing.care_invoices", f.careInvoice), "and keeps its invoice")
	assert.True(t, belegExists(t, db, "parent_billing.sepa_mandates", f.mandate), "and its mandate")
}

// TestFamilyBillingOutlivesADeletedContractOfItsFamily (#7862): the
// deviation of a family hangs on one contract. When the retention deletes
// that contract while a sibling's contract of the family remains, the
// deviation moves to the sibling's contract with its trail instead of going
// with the cascade. A family whose last contract goes loses its row, as
// before: the row lives no longer than the family's contracts.
func TestFamilyBillingOutlivesADeletedContractOfItsFamily(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger mit Geschwistern", Slug: fmt.Sprintf("geschwister-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "Geschwister OGS")
	contract := func(status, email string, endsOn any) int64 {
		t.Helper()
		id := testpkg.CreateTestCareContract(t, db, organization, school, testpkg.UniqueTestTenantID(t), "versendet", calendar.NewDate(2026, time.August, 1))
		_, err := db.ExecContext(ctx, `UPDATE care_contract.contracts SET concluded_at = '2026-08-01 10:00+02', conclusion_method = 'papier',
			status = ?, ends_on = ?::date WHERE id = ?`, status, endsOn, id)
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, `INSERT INTO care_contract.contract_parties (organization_id, contract_id, first_name, last_name, email)
			VALUES (?, ?, 'Eva', 'Muster', ?)`, organization, id, email)
		require.NoError(t, err)
		return id
	}
	older := contract("gekuendigt", "familie.a@example.org", "2027-07-31")
	ended := contract("gekuendigt", "Familie.A@example.org", "2027-07-31")
	sibling := contract("aktiv", " familie.a@example.org ", nil)
	alone := contract("gekuendigt", "familie.b@example.org", "2027-07-31")
	holidayEnded := contract("gekuendigt", "familie.c@example.org", "2027-07-31")
	holidaySibling := contract("aktiv", "familie.c@example.org", nil)
	deviation := func(family string, contractID int64) int64 {
		t.Helper()
		var id int64
		require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.family_billing (organization_id, family_email, care_contract_id,
				recipient_kind, payment_method, due_day) VALUES (?, ?, ?, 'applicant', 'direct_debit', 15) RETURNING id`,
			organization, family, contractID).Scan(ctx, &id))
		_, err := db.ExecContext(ctx, `INSERT INTO parent_billing.family_billing_events (organization_id, family_billing_id, care_contract_id, action)
			VALUES (?, ?, ?, 'save')`, organization, id, contractID)
		require.NoError(t, err)
		return id
	}
	kept := deviation("familie.a@example.org", ended)
	// An office save moved the deviation from the older contract before and
	// left its earlier trail there.
	_, err := db.ExecContext(ctx, `INSERT INTO parent_billing.family_billing_events (organization_id, family_billing_id, care_contract_id, action)
		VALUES (?, ?, ?, 'read')`, organization, kept, older)
	require.NoError(t, err)
	lost := deviation("familie.b@example.org", alone)
	// A row the holiday care used kept only its number when its contract
	// went (#6692); with a sibling's contract it keeps its whole deviation.
	holiday := deviation("familie.c@example.org", holidayEnded)
	_, err = db.ExecContext(ctx, `UPDATE parent_billing.family_billing SET last_used_on = '2026-08-01' WHERE id = ?`, holiday)
	require.NoError(t, err)

	today := calendar.NewDate(2026, time.November, 9)
	retention := NewBelegRetention(func() time.Time { return today.BerlinMidnight() })
	admin := func(fn func(context.Context) error) {
		t.Helper()
		require.NoError(t, tenant.WithinAdmin(tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db)), fn))
	}
	admin(func(adminCtx context.Context) error {
		instruct(t, retention, adminCtx, organization)
		return nil
	})
	today = calendar.NewDate(2034, time.January, 1)
	admin(func(adminCtx context.Context) error {
		_, err := retention.ApplyBelegRetention(adminCtx)
		return err
	})

	var contracts []int64
	require.NoError(t, db.NewRaw(`SELECT id FROM care_contract.contracts WHERE organization_id = ? ORDER BY id`, organization).Scan(ctx, &contracts))
	require.Equal(t, []int64{sibling, holidaySibling}, contracts, "the contracts ended in 2027 go after six years")

	var row struct {
		Contract      *int64 `bun:"care_contract_id"`
		PaymentMethod string `bun:"payment_method"`
		DueDay        *int   `bun:"due_day"`
		Events        int    `bun:"events"`
	}
	require.NoError(t, db.NewRaw(`SELECT care_contract_id, COALESCE(payment_method, '') AS payment_method, due_day,
			(SELECT count(*) FROM parent_billing.family_billing_events e WHERE e.family_billing_id = f.id AND e.care_contract_id = f.care_contract_id) AS events
		FROM parent_billing.family_billing f WHERE f.id = ?`, kept).Scan(ctx, &row), "the deviation of a family with a remaining contract stays")
	require.NotNil(t, row.Contract)
	assert.Equal(t, sibling, *row.Contract, "it hangs on the sibling's contract now")
	assert.Equal(t, "direct_debit", row.PaymentMethod, "the payment method survives")
	require.NotNil(t, row.DueDay)
	assert.Equal(t, 15, *row.DueDay)
	assert.Equal(t, 2, row.Events, "its whole trail moves with it, also the entry an earlier save left on the older contract")

	var used struct {
		Contract      *int64 `bun:"care_contract_id"`
		PaymentMethod string `bun:"payment_method"`
	}
	require.NoError(t, db.NewRaw(`SELECT care_contract_id, COALESCE(payment_method, '') AS payment_method
		FROM parent_billing.family_billing WHERE id = ?`, holiday).Scan(ctx, &used))
	require.NotNil(t, used.Contract)
	assert.Equal(t, holidaySibling, *used.Contract, "the used row moves to the sibling's contract too")
	assert.Equal(t, "direct_debit", used.PaymentMethod, "and keeps its payment method instead of being detached")

	var gone bool
	require.NoError(t, db.NewRaw(`SELECT NOT EXISTS (SELECT 1 FROM parent_billing.family_billing WHERE id = ?)`, lost).Scan(ctx, &gone))
	assert.True(t, gone, "a family whose last contract goes loses its deviation with it")
}

// TestFamilyBillingMovesToAContractTheDeletionSkips (#7862): under a
// Weisung counting from the conclusion, a terminated contract without its
// last day is due but not deleted. It is the family's remaining contract,
// so the deviation moves onto it instead of going with its own contract.
func TestFamilyBillingMovesToAContractTheDeletionSkips(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Träger mit offener Kündigung", Slug: fmt.Sprintf("offen-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "Offen OGS")
	contract := func(status string, endsOn any) int64 {
		t.Helper()
		id := testpkg.CreateTestCareContract(t, db, organization, school, testpkg.UniqueTestTenantID(t), "versendet", calendar.NewDate(2026, time.August, 1))
		_, err := db.ExecContext(ctx, `UPDATE care_contract.contracts SET concluded_at = '2026-08-01 10:00+02', conclusion_method = 'papier',
			status = ?, ends_on = ?::date WHERE id = ?`, status, endsOn, id)
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, `INSERT INTO care_contract.contract_parties (organization_id, contract_id, first_name, last_name, email)
			VALUES (?, ?, 'Eva', 'Muster', 'familie.d@example.org')`, organization, id)
		require.NoError(t, err)
		return id
	}
	held := contract("gekuendigt", "2027-07-31")
	open := contract("gekuendigt", nil)
	var deviation int64
	require.NoError(t, db.NewRaw(`INSERT INTO parent_billing.family_billing (organization_id, family_email, care_contract_id,
			recipient_kind, payment_method) VALUES (?, 'familie.d@example.org', ?, 'applicant', 'direct_debit') RETURNING id`,
		organization, held).Scan(ctx, &deviation))

	today := calendar.NewDate(2026, time.November, 9)
	retention := NewBelegRetention(func() time.Time { return today.BerlinMidnight() })
	admin := func(fn func(context.Context) error) {
		t.Helper()
		require.NoError(t, tenant.WithinAdmin(tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db)), fn))
	}
	admin(func(adminCtx context.Context) error {
		_, err := retention.RecordInstruction(adminCtx, organization, 0, parentbilling.NewRetentionInstruction{
			BelegType: parentbilling.BelegCareContract, TriggerEvent: parentbilling.TriggerContractConcluded, Period: 6,
			Basis: parentbilling.BasisBusinessLetter, LegalBasis: "§ 257 HGB", InstructedBy: "Kämmerei des Trägers",
			InstructedOn: calendar.NewDate(2026, time.November, 9), InstructionReference: "AVV-Nachtrag 2026-11",
		})
		return err
	})
	today = calendar.NewDate(2033, time.January, 1)
	admin(func(adminCtx context.Context) error {
		_, err := retention.ApplyBelegRetention(adminCtx)
		return err
	})

	var contracts []int64
	require.NoError(t, db.NewRaw(`SELECT id FROM care_contract.contracts WHERE organization_id = ? ORDER BY id`, organization).Scan(ctx, &contracts))
	require.Equal(t, []int64{open}, contracts, "the contract with its last day goes, the open termination stays")
	var on *int64
	require.NoError(t, db.NewRaw(`SELECT care_contract_id FROM parent_billing.family_billing WHERE id = ?`, deviation).Scan(ctx, &on),
		"the deviation stays with the family's remaining contract")
	require.NotNil(t, on)
	assert.Equal(t, open, *on)
}
