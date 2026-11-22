package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractOfferingCorrectionsVersion = "20261122120000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractOfferingCorrectionsVersion,
		Description: "Betreuungsvertrag: Version aus einer Korrektur der gebuchten Module (#7764)",
		DependsOn: []string{
			roomHistoryStopsVersion,    // the last migration before this one
			careContractImportsVersion, // the newest set of version sources
		},
	})
	Migrations.MustRegister(careContractOfferingCorrectionsUp, careContractOfferingCorrectionsDown)
}

// careContractOfferingCorrectionsUpSQL lets a version come from a correction
// of the modules a contract books (#7764, ADR 0306): the office names the
// module each booking of an imported contract belongs to, and the contract
// gets a new version with those modules. The earlier versions stay.
const careContractOfferingCorrectionsUpSQL = `
ALTER TABLE care_contract.contract_versions DROP CONSTRAINT chk_contract_versions_source;
ALTER TABLE care_contract.contract_versions ADD CONSTRAINT chk_contract_versions_source
	CHECK (source IN ('abschluss', 'buchungsaenderung', 'import', 'angebotskorrektur'));
COMMENT ON COLUMN care_contract.contract_versions.source IS
	'Where the version came from: abschluss (first version), buchungsaenderung (approved change of the booked care, #4681), import (first version of a contract from an import file, #4723) or angebotskorrektur (the office corrected which modules the contract books, #7764).';
`

// careContractOfferingCorrectionsDownSQL takes the corrections back: without
// the source nothing could name them. A contract that loses its wirksam
// version this way gets the newest version the correction followed or
// replaced back as wirksam; the guards refuse that step, so they are paused
// for the repair.
const careContractOfferingCorrectionsDownSQL = `
DELETE FROM care_contract.contract_versions WHERE source = 'angebotskorrektur';
ALTER TABLE care_contract.contract_versions DISABLE TRIGGER USER;
UPDATE care_contract.contract_versions AS v SET status = 'wirksam'
	WHERE v.status IN ('abgeloest', 'ersetzt')
		AND NOT EXISTS (SELECT 1 FROM care_contract.contract_versions AS w
			WHERE w.organization_id = v.organization_id AND w.contract_id = v.contract_id AND w.status = 'wirksam')
		AND v.id = (SELECT p.id FROM care_contract.contract_versions AS p
			WHERE p.organization_id = v.organization_id AND p.contract_id = v.contract_id
				AND p.status IN ('abgeloest', 'ersetzt')
			ORDER BY p.effective_from DESC, p.version_number DESC LIMIT 1);
ALTER TABLE care_contract.contract_versions ENABLE TRIGGER USER;
ALTER TABLE care_contract.contract_versions DROP CONSTRAINT chk_contract_versions_source;
ALTER TABLE care_contract.contract_versions ADD CONSTRAINT chk_contract_versions_source
	CHECK (source IN ('abschluss', 'buchungsaenderung', 'import'));
COMMENT ON COLUMN care_contract.contract_versions.source IS
	'Where the version came from: abschluss (first version), buchungsaenderung (approved change of the booked care, #4681) or import (first version of a contract from an import file, #4723).';
`

func careContractOfferingCorrectionsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractOfferingCorrectionsUpSQL); err != nil {
		return fmt.Errorf("care contract offering corrections: %w", err)
	}
	return nil
}

func careContractOfferingCorrectionsDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractOfferingCorrectionsDownSQL); err != nil {
		return fmt.Errorf("care contract offering corrections down: %w", err)
	}
	return nil
}
