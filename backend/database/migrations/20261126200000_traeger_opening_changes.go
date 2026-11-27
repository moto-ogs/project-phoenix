package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerOpeningChangesVersion = "20261126200000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerOpeningChangesVersion,
		Description: "Schulkalender: geänderte Öffnungszeiten des Trägers für ausgewählte Schulen (#8202)",
		DependsOn: []string{
			openingChangesVersion,                  // the school's own opening changes these extend
			traegerClosingDaysVersion,              // the Träger policy and school trigger this table follows
			careContractAmendmentSignaturesVersion, // the newest migration on development
		},
	})
	Migrations.MustRegister(traegerOpeningChangesUp, traegerOpeningChangesDown)
}

// traegerOpeningChangesUpSQL creates the opening changes a Träger plans for
// some or all of its schools (#8202), for example a shorter day before the
// holidays at every school.
//
// The rows belong to the Träger like schedule.traeger_closing_days: they
// carry organization_id and follow the Träger policy of ADR 0105, so the
// Träger-Büro reads and writes them in its Träger transaction. A school
// reads, never writes, the rows that name it in school_ids while it belongs
// to the row's Träger (ADR 0194): School Calendar lists them beside the
// school's own opening changes, and the earliest closing time of a day
// replaces operations.session_end_time. A trigger admits only undeleted
// schools of the row's Träger, each once. The school IDs are no foreign key:
// the rows go with the Träger.
//
// reason is the name the Träger gives the day, not a reason of a person;
// the rows hold no personal data.
const traegerOpeningChangesUpSQL = `
CREATE TABLE schedule.traeger_opening_changes (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	start_date DATE NOT NULL,
	end_date DATE NOT NULL,
	opens_at TIME NOT NULL,
	closes_at TIME NOT NULL,
	reason TEXT NOT NULL,
	school_ids BIGINT[] NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT chk_traeger_opening_changes_range CHECK (start_date <= end_date AND end_date - start_date < 366),
	CONSTRAINT chk_traeger_opening_changes_hours CHECK (opens_at < closes_at),
	CONSTRAINT chk_traeger_opening_changes_reason CHECK (BTRIM(reason) <> '' AND char_length(reason) <= 255),
	CONSTRAINT chk_traeger_opening_changes_schools CHECK (cardinality(school_ids) BETWEEN 1 AND 500)
);
CREATE INDEX idx_traeger_opening_changes_organization_range
	ON schedule.traeger_opening_changes (organization_id, start_date, end_date);
CREATE INDEX idx_traeger_opening_changes_schools
	ON schedule.traeger_opening_changes USING GIN (school_ids);
COMMENT ON TABLE schedule.traeger_opening_changes IS
	'Opening changes a Träger plans for some of its schools (#8202); written in the Träger transaction, read by the named schools.';

CREATE TRIGGER update_traeger_opening_changes_updated_at
	BEFORE UPDATE ON schedule.traeger_opening_changes
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE FUNCTION schedule.check_traeger_opening_change_schools()
	RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, pg_temp
	AS $$
	DECLARE
		v_outside BIGINT;
	BEGIN
		IF (SELECT count(*) FROM unnest(NEW.school_ids) AS id) <> (SELECT count(DISTINCT id) FROM unnest(NEW.school_ids) AS id) THEN
			RAISE EXCEPTION 'a school is named twice'
				USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_traeger_opening_changes_school_member';
		END IF;
		SELECT requested.id INTO v_outside
		FROM unnest(NEW.school_ids) AS requested(id)
		WHERE NOT EXISTS (
			SELECT 1 FROM platform.schools AS school
			WHERE school.id = requested.id
				AND school.organization_id = NEW.organization_id
				AND school.deleted_at IS NULL
		)
		LIMIT 1;
		IF v_outside IS NOT NULL THEN
			RAISE EXCEPTION 'school % is not a school of Träger %', v_outside, NEW.organization_id
				USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_traeger_opening_changes_school_member';
		END IF;
		RETURN NEW;
	END;
	$$;
CREATE TRIGGER check_traeger_opening_change_schools
	BEFORE INSERT OR UPDATE OF school_ids, organization_id ON schedule.traeger_opening_changes
	FOR EACH ROW EXECUTE FUNCTION schedule.check_traeger_opening_change_schools();

ALTER TABLE schedule.traeger_opening_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule.traeger_opening_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_schedule_traeger_opening_changes ON schedule.traeger_opening_changes FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);
CREATE POLICY school_read_schedule_traeger_opening_changes ON schedule.traeger_opening_changes FOR SELECT
	USING (NULLIF(current_setting('app.current_tenant_id', true), '')::bigint = ANY (school_ids)
		AND EXISTS (SELECT 1 FROM platform.schools AS school
			WHERE school.id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
				AND school.organization_id = traeger_opening_changes.organization_id AND school.deleted_at IS NULL));

REVOKE ALL ON schedule.traeger_opening_changes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule.traeger_opening_changes TO phoenix_tenant;
GRANT USAGE ON SEQUENCE schedule.traeger_opening_changes_id_seq TO phoenix_tenant;
`

const traegerOpeningChangesDownSQL = `
DROP TABLE IF EXISTS schedule.traeger_opening_changes;
DROP FUNCTION IF EXISTS schedule.check_traeger_opening_change_schools();
`

func traegerOpeningChangesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, traegerOpeningChangesUpSQL); err != nil {
		return fmt.Errorf("create Träger opening changes: %w", err)
	}
	return nil
}

func traegerOpeningChangesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, traegerOpeningChangesDownSQL); err != nil {
		return fmt.Errorf("drop Träger opening changes: %w", err)
	}
	return nil
}
