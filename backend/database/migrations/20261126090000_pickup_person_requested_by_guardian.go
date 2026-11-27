package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const pickupPersonRequestedByGuardianVersion = "20261126090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     pickupPersonRequestedByGuardianVersion,
		Description: "Abholperson für einen Tag: von Eltern angefragt (#8162)",
		DependsOn: []string{
			studentPickupPersonsVersion, // the table it alters
			AuthAccountsVersion,         // auth.accounts (requested_by_guardian FK)
		},
	})
	Migrations.MustRegister(pickupPersonRequestedByGuardianUp, pickupPersonRequestedByGuardianDown)
}

// pickupPersonRequestedByGuardianUpSQL records which guardian account asked
// for the day's pickup person (#8162). A family names the person in its
// one-day request; the OGS approval writes the day value and keeps the
// requesting account here, so the parents portal can say „Von dir
// eingetragen“. A staff write clears it. Deleting the account keeps the day
// value without its author (ON DELETE SET NULL), like created_by_guardian on
// the pickup exceptions; the nightly retention deletes the row after its day.
const pickupPersonRequestedByGuardianUpSQL = `
ALTER TABLE schedule.student_pickup_persons
	ADD COLUMN IF NOT EXISTS requested_by_guardian BIGINT,
	DROP CONSTRAINT IF EXISTS fk_student_pickup_persons_requested_by_guardian,
	ADD CONSTRAINT fk_student_pickup_persons_requested_by_guardian
		FOREIGN KEY (requested_by_guardian) REFERENCES auth.accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_student_pickup_persons_requested_by_guardian
	ON schedule.student_pickup_persons (requested_by_guardian) WHERE requested_by_guardian IS NOT NULL;
`

const pickupPersonRequestedByGuardianDownSQL = `
DROP INDEX IF EXISTS schedule.idx_student_pickup_persons_requested_by_guardian;
ALTER TABLE schedule.student_pickup_persons
	DROP CONSTRAINT IF EXISTS fk_student_pickup_persons_requested_by_guardian,
	DROP COLUMN IF EXISTS requested_by_guardian;
`

func pickupPersonRequestedByGuardianUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, pickupPersonRequestedByGuardianUpSQL); err != nil {
			return fmt.Errorf("add requested_by_guardian to schedule.student_pickup_persons: %w", err)
		}
		return nil
	})
}

func pickupPersonRequestedByGuardianDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, pickupPersonRequestedByGuardianDownSQL); err != nil {
			return fmt.Errorf("drop requested_by_guardian from schedule.student_pickup_persons: %w", err)
		}
		return nil
	})
}
