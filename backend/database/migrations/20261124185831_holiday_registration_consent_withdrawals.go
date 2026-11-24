package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const holidayRegistrationConsentWithdrawalsVersion = "20261124185831"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     holidayRegistrationConsentWithdrawalsVersion,
		Description: "Ferienanmeldung: Eltern widerrufen freiwillige Einwilligungen und geben sie wieder (#8038, ADR 0321)",
		DependsOn: []string{
			holidayFormDocumentsVersion, // legal_acceptances of the registration
			holidayKnownChildrenVersion, // the audit CHECKs this one extends
		},
	})
	Migrations.MustRegister(holidayRegistrationConsentWithdrawalsUp, holidayRegistrationConsentWithdrawalsDown)
}

// holidayRegistrationConsentWithdrawalsUpSQL lets the parents withdraw a
// voluntary consent of their holiday registration and give it again (#8038,
// ADR 0321):
//
//   - legal_withdrawals holds, per key of a consent block, when the parents
//     withdrew it. A withdrawal takes the key out of legal_acceptances, so
//     every reader of the acceptances (record document, export, review)
//     treats the consent as not given without change; giving it again puts
//     the key back with the new instant and removes the withdrawal.
//   - 'consent' joins the audit trail of the registration: who changed which
//     consent when, with the instant of the acceptance it ended.
const holidayRegistrationConsentWithdrawalsUpSQL = `
ALTER TABLE enrollment.holiday_registrations
	ADD COLUMN legal_withdrawals JSONB NOT NULL DEFAULT '{}'::jsonb,
	ADD CONSTRAINT chk_holiday_legal_withdrawals CHECK (jsonb_typeof(legal_withdrawals) = 'object');
COMMENT ON COLUMN enrollment.holiday_registrations.legal_withdrawals IS
	'When the parents withdrew a voluntary consent of the registration, per key of its legal block (#8038, ADR 0321); a withdrawn key is not in legal_acceptances.';
ALTER TABLE enrollment.holiday_registration_audit
	DROP CONSTRAINT IF EXISTS chk_holiday_registration_audit_action,
	DROP CONSTRAINT IF EXISTS chk_holiday_registration_audit_subject;
ALTER TABLE enrollment.holiday_registration_audit
	ADD CONSTRAINT chk_holiday_registration_audit_action CHECK (action IN ('list', 'read', 'export', 'confirm', 'cancel', 'rebook', 'freeze', 'reopen', 'proof', 'health', 'debtor_number', 'edit',
		'proof_upload', 'sibling_merge', 'sibling_split', 'sibling_cancel',
		'promote', 'capacity', 'places', 'wish', 'allocate', 'allocation', 'criteria_check', 'known_children', 'consent')),
	ADD CONSTRAINT chk_holiday_registration_audit_subject CHECK (
		(action IN ('list', 'export', 'capacity', 'places', 'allocation', 'known_children')) = (holiday_registration_id IS NULL));
`

// holidayRegistrationConsentWithdrawalsDownSQL deletes the entries of the
// parents' changes, writes back the CHECKs of 1.15.940 and drops the
// withdrawals. A withdrawn consent stays out of legal_acceptances: the
// rollback never gives a consent the parents withdrew.
const holidayRegistrationConsentWithdrawalsDownSQL = `
DELETE FROM enrollment.holiday_registration_audit WHERE action = 'consent';
ALTER TABLE enrollment.holiday_registration_audit
	DROP CONSTRAINT IF EXISTS chk_holiday_registration_audit_action,
	DROP CONSTRAINT IF EXISTS chk_holiday_registration_audit_subject;
ALTER TABLE enrollment.holiday_registration_audit
	ADD CONSTRAINT chk_holiday_registration_audit_action CHECK (action IN ('list', 'read', 'export', 'confirm', 'cancel', 'rebook', 'freeze', 'reopen', 'proof', 'health', 'debtor_number', 'edit',
		'proof_upload', 'sibling_merge', 'sibling_split', 'sibling_cancel',
		'promote', 'capacity', 'places', 'wish', 'allocate', 'allocation', 'criteria_check', 'known_children')),
	ADD CONSTRAINT chk_holiday_registration_audit_subject CHECK (
		(action IN ('list', 'export', 'capacity', 'places', 'allocation', 'known_children')) = (holiday_registration_id IS NULL));
ALTER TABLE enrollment.holiday_registrations
	DROP CONSTRAINT IF EXISTS chk_holiday_legal_withdrawals,
	DROP COLUMN IF EXISTS legal_withdrawals;
`

func holidayRegistrationConsentWithdrawalsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayRegistrationConsentWithdrawalsUpSQL); err != nil {
		return fmt.Errorf("add the consent withdrawals of the holiday registrations: %w", err)
	}
	return nil
}

func holidayRegistrationConsentWithdrawalsDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, holidayRegistrationConsentWithdrawalsDownSQL); err != nil {
		return fmt.Errorf("remove the consent withdrawals of the holiday registrations: %w", err)
	}
	return nil
}
