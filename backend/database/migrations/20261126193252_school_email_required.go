package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const schoolEmailRequiredVersion = "20261126193252"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     schoolEmailRequiredVersion,
		Description: "Kontaktadresse der Schule ist Pflicht: NOT NULL auf platform.schools.email (#7434)",
		DependsOn: []string{
			createOrgsAndSchoolsVersion, // the column it constrains
		},
	})
	Migrations.MustRegister(schoolEmailRequiredUp, schoolEmailRequiredDown)
}

// schoolEmailRequiredUpSQL makes the contact address of a school mandatory
// (#7434, #2872). Replies from parents reach a school only through it, so a
// school without one loses them. The rule holds for every row, soft-deleted
// schools included.
//
// The migration fills in nothing: a school without an address stops the
// migration with its ID. Live schools get theirs in the operator dashboard
// ("Angaben fehlen"); that list does not show soft-deleted ones. A blank
// address counts as missing, which the check constraint keeps true for
// every later write: the operator forms check it too, other writers meet
// the constraint.
const schoolEmailRequiredUpSQL = `
DO $$
DECLARE
	missing bigint[];
BEGIN
	SELECT array_agg(id ORDER BY id) INTO missing
	FROM platform.schools
	WHERE email IS NULL OR btrim(email) = '';
	IF missing IS NOT NULL THEN
		RAISE EXCEPTION 'platform.schools.email: % school(s) have no contact address (IDs %, soft-deleted ones included); set an address for each before this migration runs (#7434)',
			cardinality(missing), missing;
	END IF;
END
$$;

ALTER TABLE platform.schools ALTER COLUMN email SET NOT NULL;
ALTER TABLE platform.schools
	ADD CONSTRAINT schools_email_not_blank CHECK (btrim(email) <> '');
`

const schoolEmailRequiredDownSQL = `
ALTER TABLE platform.schools DROP CONSTRAINT IF EXISTS schools_email_not_blank;
ALTER TABLE platform.schools ALTER COLUMN email DROP NOT NULL;
`

func schoolEmailRequiredUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, schoolEmailRequiredUpSQL); err != nil {
		return fmt.Errorf("require school email: %w", err)
	}
	return nil
}

func schoolEmailRequiredDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, schoolEmailRequiredDownSQL); err != nil {
		return fmt.Errorf("drop school email requirement: %w", err)
	}
	return nil
}
