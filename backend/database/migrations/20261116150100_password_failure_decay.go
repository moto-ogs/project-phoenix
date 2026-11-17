package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const passwordFailureDecayVersion = "20261116150100"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     passwordFailureDecayVersion,
		Description: "Fehlversuche bei der Passwortanmeldung verfallen nach der Sperrdauer (#7214)",
		DependsOn: []string{
			"1.15.499", // password_attempts and password_locked_until (#3841-c)
		},
	})
	Migrations.MustRegister(passwordFailureDecayUp, passwordFailureDecayDown)
}

// passwordFailureDecayUpSQL records when the last wrong password was entered.
// A failure older than the lock duration no longer counts, so mistakes spread
// over weeks do not add up to a lock (#7214). An existing counter has no
// time: it counts from the migration on, so a guessing run in progress keeps
// its count for one more lock duration and then decays.
const passwordFailureDecayUpSQL = `
ALTER TABLE auth.accounts ADD COLUMN password_failed_at TIMESTAMPTZ;
ALTER TABLE platform.operators ADD COLUMN password_failed_at TIMESTAMPTZ;
UPDATE auth.accounts SET password_failed_at = now() WHERE password_attempts > 0;
UPDATE platform.operators SET password_failed_at = now() WHERE password_attempts > 0;
`

const passwordFailureDecayDownSQL = `
ALTER TABLE platform.operators DROP COLUMN password_failed_at;
ALTER TABLE auth.accounts DROP COLUMN password_failed_at;
`

func passwordFailureDecayUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, passwordFailureDecayUpSQL); err != nil {
			return fmt.Errorf("add password failure time: %w", err)
		}
		return nil
	})
}

func passwordFailureDecayDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, passwordFailureDecayDownSQL); err != nil {
			return fmt.Errorf("drop password failure time: %w", err)
		}
		return nil
	})
}
