package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const enrollmentContractImportSourceVersion = "20261122202200"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     enrollmentContractImportSourceVersion,
		Description: "Anmeldung: Herkunft „aus importiertem Vertrag“ für nachgezogene Anmeldungen (#7760)",
		DependsOn:   []string{lateInvitesAndRequestSourcesVersion}, // submission_source and its check
	})
	Migrations.MustRegister(enrollmentContractImportSourceUp, enrollmentContractImportSourceDown)
}

// enrollmentContractImportSourceUpSQL lets a request name an imported care
// contract as its source (#7760, ADR 0309): the enrollment the school makes
// afterwards for a child whose contract the Träger took over from a file. No
// parent submitted it, so it carries no guardian, no consent and no
// evidence. Running it again changes nothing.
const enrollmentContractImportSourceUpSQL = `
ALTER TABLE enrollment.requests DROP CONSTRAINT IF EXISTS chk_enrollment_requests_submission_source;
ALTER TABLE enrollment.requests ADD CONSTRAINT chk_enrollment_requests_submission_source
	CHECK (submission_source IN ('public', 'late_invite', 'admin_manual', 'contract_import'));
`

// enrollmentContractImportSourceDownSQL restores the three sources of
// 1.15.153. A request from an imported contract becomes a staff-entered one:
// that is the nearest source the old list knows, no parent submitted either,
// and the request with its child and bookings stays.
const enrollmentContractImportSourceDownSQL = `
UPDATE enrollment.requests SET submission_source = 'admin_manual' WHERE submission_source = 'contract_import';
ALTER TABLE enrollment.requests DROP CONSTRAINT IF EXISTS chk_enrollment_requests_submission_source;
ALTER TABLE enrollment.requests ADD CONSTRAINT chk_enrollment_requests_submission_source
	CHECK (submission_source IN ('public', 'late_invite', 'admin_manual'));
`

func enrollmentContractImportSourceUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, enrollmentContractImportSourceUpSQL); err != nil {
		return fmt.Errorf("allow enrollment requests from an imported contract: %w", err)
	}
	return nil
}

func enrollmentContractImportSourceDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, enrollmentContractImportSourceDownSQL); err != nil {
		return fmt.Errorf("restore the enrollment request sources: %w", err)
	}
	return nil
}
