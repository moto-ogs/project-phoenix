package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const guardianSalutationVersion = "20261117221357"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     guardianSalutationVersion,
		Description: "Freiwillige Anrede am Elternkontakt (#7362)",
		DependsOn:   []string{emailAddressMarksVersion},
	})
	Migrations.MustRegister(guardianSalutationUp, guardianSalutationDown)
}

// users.guardian_profiles.salutation (#7362): how the person wants to be
// addressed. NULL means no choice, and every greeting then keeps the neutral
// form with first and last name. Nullable without default, so no rewrite.
func guardianSalutationUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		ALTER TABLE users.guardian_profiles
			ADD COLUMN salutation TEXT
			CONSTRAINT guardian_profiles_salutation_check CHECK (salutation IN ('ms', 'mr'));
		COMMENT ON COLUMN users.guardian_profiles.salutation IS
			'Voluntary form of address the guardian chose (ms = Frau, mr = Herr); NULL means none, greetings stay neutral.';`)
	if err != nil {
		return fmt.Errorf("add guardian salutation: %w", err)
	}
	return nil
}

func guardianSalutationDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `ALTER TABLE users.guardian_profiles DROP COLUMN salutation`)
	if err != nil {
		return fmt.Errorf("drop guardian salutation: %w", err)
	}
	return nil
}
