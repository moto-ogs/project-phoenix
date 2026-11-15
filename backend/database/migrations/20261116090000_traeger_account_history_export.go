package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerAccountHistoryExportVersion = "20261116090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerAccountHistoryExportVersion,
		Description: "Träger-Büro: Download des Verlaufs steht im Konto-Ledger (#4718)",
		DependsOn: []string{
			traegerMemberDisplayNameVersion, // the last change of the ledger's actions
		},
	})
	Migrations.MustRegister(traegerAccountHistoryExportUp, traegerAccountHistoryExportDown)
}

// traegerAccountHistoryExportUpSQL lets the ledger of the Träger-Büro record
// a download of its history (#4718): the file holds the addresses of the
// people of the Büro, so who took it stands in the ledger like a listing of
// the members ('members_listed').
const traegerAccountHistoryExportUpSQL = `
ALTER TABLE audit.traeger_account_changes DROP CONSTRAINT chk_traeger_account_changes_action,
	ADD CONSTRAINT chk_traeger_account_changes_action CHECK (action IN (
		'invitation_created', 'invitation_revoked', 'invitation_accepted',
		'roles_changed', 'member_removed', 'members_listed', 'name_changed', 'history_exported'
	));
`

// The rollback drops the entries of the action before it leaves the CHECK.
const traegerAccountHistoryExportDownSQL = `
DELETE FROM audit.traeger_account_changes WHERE action = 'history_exported';
ALTER TABLE audit.traeger_account_changes DROP CONSTRAINT chk_traeger_account_changes_action,
	ADD CONSTRAINT chk_traeger_account_changes_action CHECK (action IN (
		'invitation_created', 'invitation_revoked', 'invitation_accepted',
		'roles_changed', 'member_removed', 'members_listed', 'name_changed'
	));
`

func traegerAccountHistoryExportUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, traegerAccountHistoryExportUpSQL); err != nil {
		return fmt.Errorf("let the Träger account ledger record a history export: %w", err)
	}
	return nil
}

func traegerAccountHistoryExportDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, traegerAccountHistoryExportDownSQL); err != nil {
		return fmt.Errorf("drop the history export of the Träger account ledger: %w", err)
	}
	return nil
}
