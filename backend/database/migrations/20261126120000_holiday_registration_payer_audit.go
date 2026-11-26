package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const holidayRegistrationPayerAuditVersion = "20261126120000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     holidayRegistrationPayerAuditVersion,
		Description: "Ferienanmeldung: Zahler nach der Bestätigung ändern, mit Eintrag im Verlauf (#8158, ADR 0325)",
		DependsOn: []string{
			holidayRegistrationConsentWithdrawalsVersion, // the audit CHECKs this one extends
			studentPickupPersonsVersion,                  // the newest migration on development
		},
	})
	Migrations.MustRegister(holidayRegistrationPayerAuditUp, holidayRegistrationPayerAuditDown)
}

// holidayRegistrationPayerAuditUpSQL lets the audit trail of a holiday
// registration take the action 'payer' (#8158, ADR 0325): the Träger-Büro
// changed who pays the contribution of a confirmed registration. The entry
// names the payer before and after and the reason.
const holidayRegistrationPayerAuditUpSQL = `
ALTER TABLE enrollment.holiday_registration_audit
	DROP CONSTRAINT IF EXISTS chk_holiday_registration_audit_action;
ALTER TABLE enrollment.holiday_registration_audit
	ADD CONSTRAINT chk_holiday_registration_audit_action CHECK (action IN ('list', 'read', 'export', 'confirm', 'cancel', 'rebook', 'freeze', 'reopen', 'proof', 'health', 'debtor_number', 'edit',
		'proof_upload', 'sibling_merge', 'sibling_split', 'sibling_cancel',
		'promote', 'capacity', 'places', 'wish', 'allocate', 'allocation', 'criteria_check', 'known_children', 'consent', 'payer'));
`

// holidayRegistrationPayerAuditDownSQL deletes the entries of the payer
// changes and writes back the CHECK of the consent withdrawals. The frozen
// contributions keep the payer they have.
const holidayRegistrationPayerAuditDownSQL = `
DELETE FROM enrollment.holiday_registration_audit WHERE action = 'payer';
ALTER TABLE enrollment.holiday_registration_audit
	DROP CONSTRAINT IF EXISTS chk_holiday_registration_audit_action;
ALTER TABLE enrollment.holiday_registration_audit
	ADD CONSTRAINT chk_holiday_registration_audit_action CHECK (action IN ('list', 'read', 'export', 'confirm', 'cancel', 'rebook', 'freeze', 'reopen', 'proof', 'health', 'debtor_number', 'edit',
		'proof_upload', 'sibling_merge', 'sibling_split', 'sibling_cancel',
		'promote', 'capacity', 'places', 'wish', 'allocate', 'allocation', 'criteria_check', 'known_children', 'consent'));
`

func holidayRegistrationPayerAuditUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayRegistrationPayerAuditUpSQL); err != nil {
		return fmt.Errorf("add the audit action payer: %w", err)
	}
	return nil
}

func holidayRegistrationPayerAuditDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayRegistrationPayerAuditDownSQL); err != nil {
		return fmt.Errorf("drop the audit action payer: %w", err)
	}
	return nil
}
