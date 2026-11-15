package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerStaffPlanningVersion = "20261115180000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerStaffPlanningVersion,
		Description: "Einsatzplanung des Trägers über alle Standorte mit Prüfung der Arbeitszeitregeln (#4708, ADR 0089 §8)",
		DependsOn: []string{
			traegerStaffContractsVersion, // the Soll of the Arbeitsverträge the weekly check sums up
			traegerAbsenceTypesVersion,   // workforce.absence_pool_access, the access rule both functions share
			traegerStaffProofsVersion,    // the last Träger migration before this one
		},
	})
	Migrations.MustRegister(traegerStaffPlanningUp, traegerStaffPlanningDown)
}

// traegerStaffPlanningUpSQL lets the Personalverwaltung plan shifts at the
// Einsatzorte of a Personalakte and gives every planner the shifts and the
// Soll of all Einsatzorte for the working-time check (#4708, ADR 0089
// section 8, ADR 0242).
//
//   - schedule.staff_shifts.planned_by_traeger marks a shift the
//     Personalverwaltung planned or last changed in the Träger-Portal. Such
//     a shift has no planning staff member of the school, so created_by may
//     be NULL for it and only for it.
//   - workforce.shift_plan_slots returns the active shifts of the requested
//     records at every Einsatzort in [p_from, p_to]. In a tenant transaction
//     school_id and shift_id are set only for that school; other schools stay
//     „anderer Einsatzort“. With p_lock it first holds each record until the
//     transaction ends, so two schools cannot plan the same hours at once.
//   - workforce.shift_plan_soll returns the Soll per record and day from the
//     Arbeitsverträge of the Träger, with the Ferien-Soll of a holiday week
//     before the regular Soll, summed over all Einsatzorte.
const traegerStaffPlanningUpSQL = `
ALTER TABLE schedule.staff_shifts
	ADD COLUMN planned_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ALTER COLUMN created_by DROP NOT NULL,
	ADD CONSTRAINT chk_staff_shifts_planner CHECK (created_by IS NOT NULL OR planned_by_traeger);
COMMENT ON COLUMN schedule.staff_shifts.planned_by_traeger IS
	'The Personalverwaltung of the Träger planned or last changed this shift in the Träger-Portal (#4708); created_by is then NULL for a shift it created.';

CREATE FUNCTION workforce.shift_plan_slots(p_staff_record_ids BIGINT[], p_from DATE, p_to DATE, p_lock BOOLEAN)
RETURNS TABLE (
	staff_record_id BIGINT, school_id BIGINT, shift_id BIGINT, date DATE,
	start_time TIME WITHOUT TIME ZONE, end_time TIME WITHOUT TIME ZONE, break_minutes INT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_records BIGINT[];
BEGIN
	SELECT array_agg(DISTINCT r.id ORDER BY r.id) INTO v_records
	FROM unnest(p_staff_record_ids) AS r(id)
	WHERE workforce.absence_pool_access(r.id) IS NOT NULL;
	IF v_records IS NULL THEN
		RETURN;
	END IF;
	IF p_lock THEN
		PERFORM pg_advisory_xact_lock(hashtextextended('workforce.shift_plan:' || ordered.id, 0))
		FROM unnest(v_records) AS ordered(id);
	END IF;
	RETURN QUERY
		SELECT l.staff_record_id,
			CASE WHEN v_school IS NULL OR l.school_id = v_school THEN l.school_id END,
			CASE WHEN v_school IS NULL OR l.school_id = v_school THEN s.id END,
			s.date, s.start_time, s.end_time, s.break_minutes
		FROM workforce.staff_record_links l
		JOIN schedule.staff_shifts s ON s.tenant_id = l.school_id AND s.staff_id = l.membership_id
		WHERE l.staff_record_id = ANY(v_records)
		  AND NOT s.cancelled
		  AND s.date BETWEEN p_from AND p_to;
END;
$$;
REVOKE ALL ON FUNCTION workforce.shift_plan_slots(BIGINT[], DATE, DATE, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.shift_plan_slots(BIGINT[], DATE, DATE, BOOLEAN) TO phoenix_tenant;

CREATE FUNCTION workforce.shift_plan_soll(p_staff_record_ids BIGINT[], p_from DATE, p_to DATE)
RETURNS TABLE (staff_record_id BIGINT, date DATE, own BOOLEAN, minutes INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_records BIGINT[];
	-- own marks the Soll of the school of the tenant transaction; only that
	-- school can subtract its holidays and closing days. Other schools stay
	-- unnamed.
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
BEGIN
	SELECT array_agg(DISTINCT r.id) INTO v_records
	FROM unnest(p_staff_record_ids) AS r(id)
	WHERE workforce.absence_pool_access(r.id) IS NOT NULL;
	IF v_records IS NULL THEN
		RETURN;
	END IF;
	RETURN QUERY
		WITH sites AS (
			SELECT DISTINCT c.staff_record_id, c.id AS contract_id, c.starts_on, c.ends_on, t.school_id
			FROM workforce.staff_contracts c
			JOIN workforce.staff_contract_targets t ON t.contract_id = c.id
			WHERE c.staff_record_id = ANY(v_records)
		), days AS (
			SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') AS d
			WHERE extract(isodow FROM d) <= 5
		)
		SELECT s.staff_record_id, d.day, COALESCE(s.school_id = v_school, false), SUM(COALESCE(
			(SELECT w.weekday_minutes[extract(isodow FROM d.day)::int]
			 FROM workforce.staff_contract_holiday_weeks w
			 WHERE w.contract_id = s.contract_id AND w.school_id = s.school_id
			   AND w.week_start = date_trunc('week', d.day)::date),
			(SELECT t.weekday_minutes[extract(isodow FROM d.day)::int]
			 FROM workforce.staff_contract_targets t
			 WHERE t.contract_id = s.contract_id AND t.school_id = s.school_id AND t.valid_from <= d.day
			 ORDER BY t.valid_from DESC LIMIT 1),
			0))::int
		FROM sites s
		JOIN days d ON d.day >= s.starts_on AND (s.ends_on IS NULL OR d.day <= s.ends_on)
		GROUP BY s.staff_record_id, d.day, COALESCE(s.school_id = v_school, false);
END;
$$;
REVOKE ALL ON FUNCTION workforce.shift_plan_soll(BIGINT[], DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.shift_plan_soll(BIGINT[], DATE, DATE) TO phoenix_tenant;
`

const traegerStaffPlanningDownSQL = `
DROP FUNCTION IF EXISTS workforce.shift_plan_soll(BIGINT[], DATE, DATE);
DROP FUNCTION IF EXISTS workforce.shift_plan_slots(BIGINT[], DATE, DATE, BOOLEAN);
DELETE FROM schedule.staff_shifts WHERE created_by IS NULL;
ALTER TABLE schedule.staff_shifts
	DROP CONSTRAINT IF EXISTS chk_staff_shifts_planner,
	ALTER COLUMN created_by SET NOT NULL,
	DROP COLUMN IF EXISTS planned_by_traeger;
`

func traegerStaffPlanningUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffPlanningUpSQL); err != nil {
			return fmt.Errorf("add traeger staff planning: %w", err)
		}
		return nil
	})
}

func traegerStaffPlanningDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffPlanningDownSQL); err != nil {
			return fmt.Errorf("drop traeger staff planning: %w", err)
		}
		return nil
	})
}
