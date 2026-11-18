package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const timeTrackingAuditRecordedAtVersion = "20261118092325"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     timeTrackingAuditRecordedAtVersion,
		Description: "Arbeitszeitprotokoll nach einem Zeitstempel der Datenbank ordnen (#7383)",
		DependsOn:   []string{traegerMonthCloseVersion},
	})
	Migrations.MustRegister(timeTrackingAuditRecordedAtUp, timeTrackingAuditRecordedAtDown)
}

// Adding the nullable columns before setting defaults leaves old rows unstamped.
const timeTrackingAuditStampColumns = `
	ALTER TABLE audit.work_session_edits ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE active.staff_absence_audit ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE active.staff_balance_adjustments ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE active.staff_month_balance_snapshots ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE audit.time_tracking_deletions ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE active.staff_vacation_openings ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE active.staff_absence_type_allowance_changes ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE audit.personnel_number_changes ADD COLUMN audit_recorded_at TIMESTAMPTZ;
	ALTER TABLE active.staff_vacation_quota_changes ADD COLUMN audit_recorded_at TIMESTAMPTZ;

	ALTER TABLE audit.work_session_edits ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE active.staff_absence_audit ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE active.staff_balance_adjustments ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE active.staff_month_balance_snapshots ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE audit.time_tracking_deletions ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE active.staff_vacation_openings ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE active.staff_absence_type_allowance_changes ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE audit.personnel_number_changes ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
	ALTER TABLE active.staff_vacation_quota_changes ALTER COLUMN audit_recorded_at SET DEFAULT clock_timestamp();
`

const timeTrackingAuditDropColumns = `
	ALTER TABLE audit.work_session_edits DROP COLUMN audit_recorded_at;
	ALTER TABLE active.staff_absence_audit DROP COLUMN audit_recorded_at;
	ALTER TABLE active.staff_balance_adjustments DROP COLUMN audit_recorded_at;
	ALTER TABLE active.staff_month_balance_snapshots DROP COLUMN audit_recorded_at;
	ALTER TABLE audit.time_tracking_deletions DROP COLUMN audit_recorded_at;
	ALTER TABLE active.staff_vacation_openings DROP COLUMN audit_recorded_at;
	ALTER TABLE active.staff_absence_type_allowance_changes DROP COLUMN audit_recorded_at;
	ALTER TABLE audit.personnel_number_changes DROP COLUMN audit_recorded_at;
	ALTER TABLE active.staff_vacation_quota_changes DROP COLUMN audit_recorded_at;
`

const timeTrackingAuditStampUpdates = `
	ALTER TABLE active.staff_month_balance_snapshots ADD COLUMN audit_reopen_recorded_at TIMESTAMPTZ;
	CREATE FUNCTION audit.stamp_time_tracking_recorded_at() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog AS $$
	BEGIN
		NEW.audit_recorded_at := clock_timestamp();
		RETURN NEW;
	END;
	$$;
	CREATE TRIGGER staff_balance_adjustment_audit_recorded_at
		BEFORE UPDATE OF staff_id, type, minutes_delta, effective_date, decided_at, decided_by, note ON active.staff_balance_adjustments
		FOR EACH ROW WHEN (
			(OLD.staff_id, OLD.type, OLD.minutes_delta, OLD.effective_date, OLD.decided_at, OLD.decided_by, OLD.note) IS DISTINCT FROM
			(NEW.staff_id, NEW.type, NEW.minutes_delta, NEW.effective_date, NEW.decided_at, NEW.decided_by, NEW.note))
		EXECUTE FUNCTION audit.stamp_time_tracking_recorded_at();
	CREATE TRIGGER staff_vacation_opening_audit_recorded_at
		BEFORE UPDATE OF staff_id, year, effective_date, taken_before_days, entered_remaining_days, decided_at, decided_by, note
		ON active.staff_vacation_openings FOR EACH ROW WHEN (
			(OLD.staff_id, OLD.year, OLD.effective_date, OLD.taken_before_days, OLD.entered_remaining_days, OLD.decided_at, OLD.decided_by, OLD.note)
			IS DISTINCT FROM
			(NEW.staff_id, NEW.year, NEW.effective_date, NEW.taken_before_days, NEW.entered_remaining_days, NEW.decided_at, NEW.decided_by, NEW.note))
		EXECUTE FUNCTION audit.stamp_time_tracking_recorded_at();

	CREATE FUNCTION audit.stamp_time_tracking_reopen() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog AS $$
	BEGIN
		IF TG_OP = 'UPDATE' AND NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at THEN
			RETURN NEW;
		END IF;
		NEW.audit_reopen_recorded_at := CASE WHEN NEW.reopened_at IS NOT NULL THEN clock_timestamp() END;
		RETURN NEW;
	END;
	$$;
	CREATE TRIGGER staff_month_reopen_audit_recorded_at
		BEFORE INSERT OR UPDATE OF reopened_at ON active.staff_month_balance_snapshots
		FOR EACH ROW EXECUTE FUNCTION audit.stamp_time_tracking_reopen();
`

// Keep each existing business timestamp and the batch grouping keys. In the
// grouped branches the feed uses the first database stamp of the batch. Old
// rows retain the time on record because the database never stamped their write.
const timeTrackingAuditLegacyView = timeTrackingAuditViewHeader + "e.created_at AS occurred_at" +
	timeTrackingAuditViewSessionEdits + "saa.changed_at" +
	timeTrackingAuditViewAbsences + "ba.decided_at" +
	timeTrackingAuditViewAdjustments + "s.closed_at" +
	timeTrackingAuditViewMonthCloses + "s.reopened_at" +
	timeTrackingAuditViewMonthReopens + "d.occurred_at" +
	timeTrackingAuditViewDeletions + "vo.decided_at" +
	timeTrackingAuditViewVacationOpenings + "c.created_at" +
	timeTrackingAuditViewAbsenceAllowances + "c.occurred_at" +
	timeTrackingAuditViewPersonnelNumbers + "q.created_at" +
	timeTrackingAuditViewVacationQuotas

const timeTrackingAuditRecordedView = timeTrackingAuditViewHeader + "COALESCE(MIN(e.audit_recorded_at), e.created_at) AS occurred_at" +
	timeTrackingAuditViewSessionEdits + "COALESCE(saa.audit_recorded_at, saa.changed_at)" +
	timeTrackingAuditViewAbsences + "COALESCE(ba.audit_recorded_at, ba.decided_at)" +
	timeTrackingAuditViewAdjustments + "COALESCE(MIN(s.audit_recorded_at), s.closed_at)" +
	timeTrackingAuditViewMonthCloses + "COALESCE(s.audit_reopen_recorded_at, s.reopened_at)" +
	timeTrackingAuditViewMonthReopens + "COALESCE(d.audit_recorded_at, d.occurred_at)" +
	timeTrackingAuditViewDeletions + "COALESCE(vo.audit_recorded_at, vo.decided_at)" +
	timeTrackingAuditViewVacationOpenings + "COALESCE(c.audit_recorded_at, c.created_at)" +
	timeTrackingAuditViewAbsenceAllowances + "COALESCE(c.audit_recorded_at, c.occurred_at)" +
	timeTrackingAuditViewPersonnelNumbers + "COALESCE(q.audit_recorded_at, q.created_at)" +
	timeTrackingAuditViewVacationQuotas

const timeTrackingAuditViewHeader = `
		CREATE OR REPLACE VIEW audit.time_tracking_audit_log WITH (security_invoker = true) AS
		SELECT e.tenant_id, `

const timeTrackingAuditViewSessionEdits = `, 'session_edit'::text AS source,
			MIN(e.id) AS entry_id, e.staff_id, ARRAY[e.staff_id] AS staff_ids,
			NULLIF(e.edited_by, 0) AS actor_staff_id, e.edited_by = 0 AS actor_is_system,
			COALESCE(MAX(NULLIF(e.notes, '')), '')::text AS reason,
			jsonb_build_object(
				'session_id', e.session_id, 'session_date', to_char(ws.date, 'YYYY-MM-DD'),
				'fields', jsonb_agg(jsonb_build_object(
					'field', e.field_name, 'old', e.old_value, 'new', e.new_value
				) ORDER BY e.id)
			) AS detail
		FROM audit.work_session_edits e
		JOIN active.work_sessions ws ON ws.id = e.session_id AND ws.tenant_id = e.tenant_id
		GROUP BY e.tenant_id, e.session_id, e.staff_id, e.edited_by, e.created_at, ws.date
		UNION ALL
		SELECT saa.tenant_id, `

const timeTrackingAuditViewAbsences = `, 'absence'::text, saa.id, sa.staff_id,
			ARRAY[sa.staff_id], st.id, FALSE, COALESCE(saa.note, '')::text,
			jsonb_build_object(
				'absence_id', sa.id, 'absence_type', sa.absence_type,
				'absence_type_label', sat.name,
				'date_start', to_char(sa.date_start, 'YYYY-MM-DD'),
				'date_end', to_char(sa.date_end, 'YYYY-MM-DD'),
				'from_status', saa.from_status, 'to_status', saa.to_status,
				'from_absence_type', saa.from_absence_type,
				'to_absence_type', saa.to_absence_type,
				'from_absence_type_label', sat_from.name,
				'to_absence_type_label', sat_to.name
			)
		FROM active.staff_absence_audit saa
		JOIN active.staff_absences sa ON sa.id = saa.absence_id AND sa.tenant_id = saa.tenant_id
		LEFT JOIN active.staff_absence_types sat
			ON sat.tenant_id = sa.tenant_id AND sat.id = sa.absence_type_id
		LEFT JOIN active.staff_absence_types sat_from
			ON sat_from.tenant_id = saa.tenant_id AND sat_from.id = saa.from_absence_type_id
		LEFT JOIN active.staff_absence_types sat_to
			ON sat_to.tenant_id = saa.tenant_id AND sat_to.id = saa.to_absence_type_id
		LEFT JOIN users.persons p ON p.account_id = saa.actor_id
		LEFT JOIN users.staff_school_memberships st ON st.person_id = p.id
		UNION ALL
		SELECT ba.tenant_id, `

const timeTrackingAuditViewAdjustments = `, 'adjustment'::text, ba.id, ba.staff_id,
			ARRAY[ba.staff_id], ba.decided_by, FALSE, ba.note::text,
			jsonb_build_object(
				'adjustment_id', ba.id, 'type', ba.type,
				'minutes_delta', ba.minutes_delta,
				'effective_date', to_char(ba.effective_date, 'YYYY-MM-DD')
			)
		FROM active.staff_balance_adjustments ba
		UNION ALL
		SELECT s.tenant_id, `

const timeTrackingAuditViewMonthCloses = `, 'month_close'::text, MIN(s.id), NULL::bigint,
			array_agg(s.staff_id), s.closed_by, FALSE, s.close_reason::text,
			jsonb_build_object('year', s.year, 'month', s.month, 'account_count', COUNT(*),
				'by_traeger', s.source = 'traeger')
		FROM active.staff_month_balance_snapshots s
		GROUP BY s.tenant_id, s.closed_at, s.closed_by, s.year, s.month, s.close_reason, s.source
		UNION ALL
		SELECT s.tenant_id, `

const timeTrackingAuditViewMonthReopens = `, 'month_reopen'::text, s.id, s.staff_id,
			ARRAY[s.staff_id], s.reopened_by, FALSE, s.reopen_reason::text,
			jsonb_build_object(
				'year', s.year, 'month', s.month,
				'closing_balance_minutes', s.closing_balance_minutes,
				'by_traeger', s.source = 'traeger'
			)
		FROM active.staff_month_balance_snapshots s
		WHERE s.reopened_at IS NOT NULL
		UNION ALL
		SELECT d.tenant_id, `

const timeTrackingAuditViewDeletions = `, 'deletion'::text, d.id, d.staff_id,
			ARRAY[d.staff_id], d.deleted_by, FALSE, d.note::text,
			jsonb_build_object(
				'deleted_source', d.source, 'source_id', d.source_id, 'payload', d.payload
			)
		FROM audit.time_tracking_deletions d
		UNION ALL
		SELECT vo.tenant_id, `

const timeTrackingAuditViewVacationOpenings = `, 'vacation_opening'::text, vo.id, vo.staff_id,
			ARRAY[vo.staff_id], vo.decided_by, FALSE, vo.note::text,
			jsonb_build_object(
				'opening_id', vo.id, 'year', vo.year,
				'effective_date', to_char(vo.effective_date, 'YYYY-MM-DD'),
				'taken_before_days', vo.taken_before_days,
				'entered_remaining_days', vo.entered_remaining_days
			)
		FROM active.staff_vacation_openings vo
		UNION ALL
		SELECT c.tenant_id, `

const timeTrackingAuditViewAbsenceAllowances = `, 'absence_type_allowance'::text, c.id, c.staff_id,
			ARRAY[c.staff_id], c.changed_by, FALSE, c.reason::text,
			jsonb_build_object(
				'absence_type_id', c.absence_type_id, 'absence_type_label', sat.name,
				'year', c.year, 'old_entitled_days', c.old_entitled_days,
				'new_entitled_days', c.new_entitled_days
			)
		FROM active.staff_absence_type_allowance_changes c
		JOIN active.staff_absence_types sat
			ON sat.tenant_id = c.tenant_id AND sat.id = c.absence_type_id
		UNION ALL
		SELECT c.tenant_id, `

const timeTrackingAuditViewPersonnelNumbers = `, 'personnel_number'::text, c.id, c.staff_id,
			ARRAY[c.staff_id], c.changed_by, FALSE, c.note::text,
			jsonb_build_object('old_value', c.old_value, 'new_value', c.new_value)
		FROM audit.personnel_number_changes c
		UNION ALL
		SELECT q.tenant_id, `

const timeTrackingAuditViewVacationQuotas = `, 'vacation_quota'::text, q.id, q.staff_id,
			ARRAY[q.staff_id], q.changed_by, FALSE, q.reason::text,
			jsonb_build_object(
				'year', q.year,
				'old_entitled_days', q.old_entitled_days, 'new_entitled_days', q.new_entitled_days,
				'old_carryover_days', q.old_carryover_days, 'new_carryover_days', q.new_carryover_days
			)
		FROM active.staff_vacation_quota_changes q;

		GRANT SELECT ON audit.time_tracking_audit_log TO phoenix_tenant;
`

func timeTrackingAuditRecordedAtUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, timeTrackingAuditStampColumns+timeTrackingAuditStampUpdates+timeTrackingAuditRecordedView); err != nil {
			return fmt.Errorf("install the time tracking audit stamps and view: %w", err)
		}
		return nil
	})
}

func timeTrackingAuditRecordedAtDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, timeTrackingAuditLegacyView+`
			DROP TRIGGER staff_balance_adjustment_audit_recorded_at ON active.staff_balance_adjustments;
			DROP TRIGGER staff_vacation_opening_audit_recorded_at ON active.staff_vacation_openings;
			DROP TRIGGER staff_month_reopen_audit_recorded_at ON active.staff_month_balance_snapshots;
			DROP FUNCTION audit.stamp_time_tracking_recorded_at();
			DROP FUNCTION audit.stamp_time_tracking_reopen();
			ALTER TABLE active.staff_month_balance_snapshots DROP COLUMN audit_reopen_recorded_at;
		`+timeTrackingAuditDropColumns); err != nil {
			return fmt.Errorf("restore the time tracking audit view: %w", err)
		}
		return nil
	})
}
