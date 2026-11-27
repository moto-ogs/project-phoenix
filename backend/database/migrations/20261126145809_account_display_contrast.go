package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const accountDisplayContrastVersion = "20261126145809"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     accountDisplayContrastVersion,
		Description: "Anzeige „Mehr Kontrast“ je Konto und je Operator",
		DependsOn: []string{
			AuthAccountsVersion,         // auth.accounts
			createPlatformSchemaVersion, // platform.operators
		},
	})
	Migrations.MustRegister(accountDisplayContrastUp, accountDisplayContrastDown)
}

// accountDisplayContrastUp stores the display preference "Mehr Kontrast"
// (dark borders on form controls) of the person behind an account, and of an
// operator, whose IDs are a space of their own. NULL means not decided: the
// browser then follows the device's prefers-contrast. The preference belongs
// to the person, not to a school, so one answer holds in every portal.
func accountDisplayContrastUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `
		ALTER TABLE auth.accounts ADD COLUMN IF NOT EXISTS more_contrast BOOLEAN;
		ALTER TABLE platform.operators ADD COLUMN IF NOT EXISTS more_contrast BOOLEAN;
	`); err != nil {
		return fmt.Errorf("add display contrast preference: %w", err)
	}
	return nil
}

func accountDisplayContrastDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `
		ALTER TABLE platform.operators DROP COLUMN IF EXISTS more_contrast;
		ALTER TABLE auth.accounts DROP COLUMN IF EXISTS more_contrast;
	`); err != nil {
		return fmt.Errorf("drop display contrast preference: %w", err)
	}
	return nil
}
