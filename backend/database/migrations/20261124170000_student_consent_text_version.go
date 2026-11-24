package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const studentConsentTextVersionVersion = "20261124170000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     studentConsentTextVersionVersion,
		Description: "Einwilligungsverlauf: Eine Foto-Einwilligung hält die Fassung des Wortlauts fest, der ihr zugrunde lag (#8039)",
		DependsOn: []string{
			parentStudentConsentsVersion, // creates audit.student_consent_changes
		},
	})
	Migrations.MustRegister(studentConsentTextVersionUp, studentConsentTextVersionDown)
}

// studentConsentTextVersionUpSQL lets a consent change name the version of
// the wording it confirmed (#8039). The parent and the tenant portal show
// moto's fixed photo wording; their grants record its version. Withdrawals,
// enrollment (the school's own legal block, kept with the request), imports
// and migration snapshots record none. Entries before this column stay NULL:
// moto does not know which wording they showed. The table grants cover the
// new column as they cover the others.
const studentConsentTextVersionUpSQL = `
ALTER TABLE audit.student_consent_changes ADD COLUMN IF NOT EXISTS text_version TEXT;
COMMENT ON COLUMN audit.student_consent_changes.text_version IS
	'Version of moto''s wording a grant in the parent or tenant portal confirmed, e.g. photo-1 (#8039). NULL: withdrawal, enrollment, import, migration snapshot or recorded before the column; moto does not know that wording.';
`

const studentConsentTextVersionDownSQL = `
ALTER TABLE audit.student_consent_changes DROP COLUMN IF EXISTS text_version;
`

func studentConsentTextVersionUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, studentConsentTextVersionUpSQL); err != nil {
		return fmt.Errorf("add the text version of a student consent change: %w", err)
	}
	return nil
}

func studentConsentTextVersionDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, studentConsentTextVersionDownSQL); err != nil {
		return fmt.Errorf("drop the text version of a student consent change: %w", err)
	}
	return nil
}
