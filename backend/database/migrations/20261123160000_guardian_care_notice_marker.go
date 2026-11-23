package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const guardianCareNoticeMarkerVersion = "20261123160000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     guardianCareNoticeMarkerVersion,
		Description: "Elternschritt: Zugang eines Elternteils merkt sich die Nachricht, dass die Betreuung im Elternportal sichtbar ist (#7760)",
		DependsOn: []string{
			guardianStorageExpandVersion,            // creates auth.guardian_student_access
			careContractApplicationUnbindingVersion, // the newest migration of #7760
		},
	})
	Migrations.MustRegister(guardianCareNoticeMarkerUp, guardianCareNoticeMarkerDown)
}

// guardianCareNoticeMarkerUpSQL gives the parents-portal access of one
// guardian to one child the moment the school's bulk invitation mailed the
// care notice (#7760, ADR 0309 section 5). A later run with the option skips
// the relationship, so nobody gets the mail twice for the same child. The
// column belongs to the access row Identity & Access owns; the table grants
// and row-level security cover it as they cover the other columns. NULL: no
// notice yet. Running it again changes nothing.
const guardianCareNoticeMarkerUpSQL = `
ALTER TABLE auth.guardian_student_access ADD COLUMN IF NOT EXISTS care_notice_sent_at TIMESTAMPTZ;
COMMENT ON COLUMN auth.guardian_student_access.care_notice_sent_at IS
	'When the bulk invitation mailed this guardian that the child''s care is visible in the parents portal (#7760). NULL: not yet.';
`

const guardianCareNoticeMarkerDownSQL = `
ALTER TABLE auth.guardian_student_access DROP COLUMN IF EXISTS care_notice_sent_at;
`

func guardianCareNoticeMarkerUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, guardianCareNoticeMarkerUpSQL); err != nil {
		return fmt.Errorf("add the care notice marker of guardian access: %w", err)
	}
	return nil
}

func guardianCareNoticeMarkerDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, guardianCareNoticeMarkerDownSQL); err != nil {
		return fmt.Errorf("drop the care notice marker of guardian access: %w", err)
	}
	return nil
}
