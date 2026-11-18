package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const schoolHolidayCostCenterVersion = "20261117222123"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     schoolHolidayCostCenterVersion,
		Description: "Elternabrechnung: eigene Kostenstelle der Ferienbetreuung je Schule (#7357)",
		DependsOn:   []string{parentBillingBookingAccountsVersion}, // the cost centers and their scopes (1.15.906)
	})
	Migrations.MustRegister(schoolHolidayCostCenterUp, schoolHolidayCostCenterDown)
}

// schoolHolidayCostCenterUpSQL lets a school carry a KOST1 of the holiday
// care it hosts beside its KOST1 (#7357): cost_centers scope
// 'school_holiday', scope_id the school. A holiday week books on it from
// its valid_from; without one it books on the KOST1 of the school as
// before (#6624). chk_cost_centers_scope_id already asks a school of every
// scope but 'holiday'.
const schoolHolidayCostCenterUpSQL = `
ALTER TABLE parent_billing.cost_centers
	DROP CONSTRAINT chk_cost_centers_scope,
	ADD CONSTRAINT chk_cost_centers_scope CHECK (scope IN ('school', 'school_holiday', 'holiday', 'offering'));
COMMENT ON TABLE parent_billing.cost_centers IS
	'Cost center (KOST1 of a school, of the holiday care a school hosts or of the holiday care of the Träger, KOST2 of an Angebot) from valid_from until the next row of its scope (#4821, #7357); an empty code ends it.';
`

// schoolHolidayCostCenterDownSQL takes the holiday KOST1 of the schools
// away again; their weeks book on the KOST1 of the school from then on.
// Issued positions keep the value their release copied.
const schoolHolidayCostCenterDownSQL = `
DELETE FROM parent_billing.cost_centers WHERE scope = 'school_holiday';
ALTER TABLE parent_billing.cost_centers
	DROP CONSTRAINT chk_cost_centers_scope,
	ADD CONSTRAINT chk_cost_centers_scope CHECK (scope IN ('school', 'holiday', 'offering'));
COMMENT ON TABLE parent_billing.cost_centers IS
	'Cost center (KOST1 of a school or the holiday care, KOST2 of an Angebot) from valid_from until the next row of its scope (#4821); an empty code ends it.';
`

func schoolHolidayCostCenterUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, schoolHolidayCostCenterUpSQL); err != nil {
		return fmt.Errorf("add the holiday cost center of a school: %w", err)
	}
	return nil
}

func schoolHolidayCostCenterDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, schoolHolidayCostCenterDownSQL); err != nil {
		return fmt.Errorf("drop the holiday cost center of a school: %w", err)
	}
	return nil
}
