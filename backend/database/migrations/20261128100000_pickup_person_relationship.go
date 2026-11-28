package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const pickupPersonRelationshipVersion = "20261128100000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     pickupPersonRelationshipVersion,
		Description: "Abholperson für einen Tag: Verbindung zur Abholerlaubnis (#8206)",
		DependsOn: []string{
			pickupPersonRequestedByGuardianVersion, // the latest change of the table
			guardianStorageExpandVersion,           // users.student_guardian_relationships (tenant_id, id)
		},
	})
	Migrations.MustRegister(pickupPersonRelationshipUp, pickupPersonRelationshipDown)
}

// pickupPersonRelationshipUpSQL links a day's pickup person who is a contact
// of the child to the relationship of child and contact (#8206). Care Plan
// owns the pickup permission of that relationship
// (users.student_guardian_pickup_permissions, keyed by relationship_id), so
// the link lets it read the permission with the day and remove the days of a
// withdrawn weekday, without reading People Directory's relationship table.
// The relationship is a lookup of the pair the row already names, like a
// foreign key: a trigger sets it on every write, for each writer alike
// (staff, approved one-day requests, corrections), and the backfill links
// the rows written before. A contact no longer linked to the child leaves it
// empty, and the day reads as without permission. Unlinking the contact
// takes the day values with it, as deleting the contact already does.
const pickupPersonRelationshipUpSQL = `
ALTER TABLE schedule.student_pickup_persons
	ADD COLUMN IF NOT EXISTS relationship_id BIGINT,
	DROP CONSTRAINT IF EXISTS fk_student_pickup_persons_relationship,
	ADD CONSTRAINT fk_student_pickup_persons_relationship
		FOREIGN KEY (tenant_id, relationship_id)
		REFERENCES users.student_guardian_relationships(tenant_id, id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION schedule.link_student_pickup_person_relationship()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW.guardian_profile_id IS NULL THEN
		NEW.relationship_id := NULL;
	ELSE
		SELECT r.id INTO NEW.relationship_id
		FROM users.student_guardian_relationships AS r
		WHERE r.tenant_id = NEW.tenant_id AND r.student_id = NEW.student_id
			AND r.guardian_profile_id = NEW.guardian_profile_id;
	END IF;
	RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS link_student_pickup_person_relationship ON schedule.student_pickup_persons;
CREATE TRIGGER link_student_pickup_person_relationship
BEFORE INSERT OR UPDATE OF tenant_id, student_id, guardian_profile_id, relationship_id ON schedule.student_pickup_persons
FOR EACH ROW EXECUTE FUNCTION schedule.link_student_pickup_person_relationship();
CREATE INDEX IF NOT EXISTS idx_student_pickup_persons_relationship
	ON schedule.student_pickup_persons (tenant_id, relationship_id, exception_date) WHERE relationship_id IS NOT NULL;
`

// pickupPersonRelationshipBackfillSQL links the rows written before the
// trigger; the trigger sets the column itself.
const pickupPersonRelationshipBackfillSQL = `
UPDATE schedule.student_pickup_persons AS p
SET guardian_profile_id = p.guardian_profile_id
WHERE p.relationship_id IS NULL AND p.guardian_profile_id IS NOT NULL;
`

const pickupPersonRelationshipDownSQL = `
DROP INDEX IF EXISTS schedule.idx_student_pickup_persons_relationship;
DROP TRIGGER IF EXISTS link_student_pickup_person_relationship ON schedule.student_pickup_persons;
DROP FUNCTION IF EXISTS schedule.link_student_pickup_person_relationship();
ALTER TABLE schedule.student_pickup_persons
	DROP CONSTRAINT IF EXISTS fk_student_pickup_persons_relationship,
	DROP COLUMN IF EXISTS relationship_id;
`

func pickupPersonRelationshipUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, pickupPersonRelationshipUpSQL); err != nil {
			return fmt.Errorf("add relationship_id to schedule.student_pickup_persons: %w", err)
		}
		if _, err := tx.ExecContext(ctx, pickupPersonRelationshipBackfillSQL); err != nil {
			return fmt.Errorf("link the pickup persons to their relationships: %w", err)
		}
		return nil
	})
}

// pickupPersonRelationshipFingerprint is the incoming-FK fingerprint of the
// school erasure plan with the relationship link; the repeatable preflight
// checks it. The erasure deletes the pickup persons before the
// relationships, so the new edge needs no further step.
const pickupPersonRelationshipFingerprint = "5925f11f2605f3fcfde264eeac4433c2ee270161b7f99864291883340690e421"

// pickupPersonRelationshipDown drops the link and points the installed
// preflight back at the fingerprint before it, so an erasure after the
// rollback still runs.
func pickupPersonRelationshipDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, pickupPersonRelationshipDownSQL); err != nil {
			return fmt.Errorf("drop relationship_id from schedule.student_pickup_persons: %w", err)
		}
		var definition string
		if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, "platform.school_erasure_preflight(bigint,bigint)").Scan(ctx, &definition); err != nil {
			return fmt.Errorf("read the school erasure preflight: %w", err)
		}
		if !strings.Contains(definition, "'"+pickupPersonRelationshipFingerprint+"'") {
			return nil
		}
		definition = strings.Replace(definition, "'"+pickupPersonRelationshipFingerprint+"'", "'"+studentPickupPersonsFingerprint+"'", 1)
		if err := installDerivedSchoolErasureFunctions(ctx, tx, []string{definition}); err != nil {
			return fmt.Errorf("restore the school erasure fingerprint: %w", err)
		}
		return nil
	})
}
