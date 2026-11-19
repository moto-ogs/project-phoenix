package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const invitationGenderVersion = "20261118175055"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     invitationGenderVersion,
		Description: "Geschlecht der eingeladenen Person für die Stammdaten speichern",
		DependsOn:   []string{AuthInvitationTokensVersion},
	})
	Migrations.MustRegister(invitationGenderUp, invitationGenderDown)
}

// The vocabulary is the one of users.staff_master_data.gender; NULL means
// the school left the field empty.
func invitationGenderUp(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `ALTER TABLE auth.invitation_tokens
 ADD COLUMN gender TEXT CONSTRAINT invitation_tokens_gender_check CHECK (gender IN ('female', 'male', 'diverse'))`)
	if err != nil {
		return fmt.Errorf("add invitation gender: %w", err)
	}
	return nil
}

func invitationGenderDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `ALTER TABLE auth.invitation_tokens DROP COLUMN gender`)
	if err != nil {
		return fmt.Errorf("drop invitation gender: %w", err)
	}
	return nil
}
