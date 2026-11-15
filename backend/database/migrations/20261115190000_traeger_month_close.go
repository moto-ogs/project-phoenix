package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerMonthCloseVersion = "20261115190000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerMonthCloseVersion,
		Description: "Monatsabschluss des Trägers je Person in jeder Schule ihrer Personalakte (#4711, ADR 0243)",
		DependsOn: []string{
			staffMonthBalanceSnapshotsVersion, // the month close the Träger writes into each school (#1417)
			traegerStaffContractsVersion,      // the contracts that decide who the Träger closes (#4706)
		},
	})
	Migrations.MustRegister(traegerMonthCloseUp, traegerMonthCloseDown)
}

// traegerMonthCloseUpSQL lets the Personalverwaltung of a Träger close and
// reopen the month of a person with an Arbeitsvertrag in every school of her
// Personalakte (ADR 0243). The close stays the school's snapshot row, so the
// school's locks and the frozen Übertrag work unchanged.
//
//   - source 'traeger' marks a close of the Träger. It names the Träger
//     account in closed_by_account_id instead of a staff member of the
//     school, and only the Träger reopens it (reopened_by_account_id). The
//     account is a plain id like created_by_account_id of the contracts:
//     the snapshot outlives the account's role at the Träger.
//   - The time-tracking audit view marks both entries with by_traeger, so the
//     school's log names the Personalverwaltung instead of an empty actor.
const traegerMonthCloseUpSQL = `
ALTER TABLE active.staff_month_balance_snapshots
	ALTER COLUMN closed_by DROP NOT NULL,
	ADD COLUMN closed_by_account_id BIGINT,
	ADD COLUMN reopened_by_account_id BIGINT,
	DROP CONSTRAINT chk_smbs_source,
	ADD CONSTRAINT chk_smbs_source CHECK (source IN ('admin','scheduler','migration','traeger')),
	ADD CONSTRAINT chk_smbs_closer CHECK (
		CASE WHEN source = 'traeger' THEN closed_by IS NULL AND closed_by_account_id IS NOT NULL
		ELSE closed_by IS NOT NULL AND closed_by_account_id IS NULL END),
	DROP CONSTRAINT chk_smbs_reopen,
	ADD CONSTRAINT chk_smbs_reopen CHECK (
		CASE WHEN reopened_at IS NULL THEN reopened_by IS NULL AND reopened_by_account_id IS NULL
		WHEN source = 'traeger' THEN reopened_by IS NULL AND reopened_by_account_id IS NOT NULL
		ELSE reopened_by IS NOT NULL AND reopened_by_account_id IS NULL END);
COMMENT ON COLUMN active.staff_month_balance_snapshots.closed_by_account_id IS
	'Account of the Personalverwaltung that closed the month for the Träger (source traeger, #4711).';
COMMENT ON COLUMN active.staff_month_balance_snapshots.reopened_by_account_id IS
	'Account of the Personalverwaltung that reopened a close of the Träger (#4711).';
`

// traegerMonthCloseAuditLogView is staffOwnerAuditLogView with by_traeger in
// the detail of the month close and reopen entries.
const traegerMonthCloseAuditLogView = `
		CREATE OR REPLACE VIEW audit.time_tracking_audit_log WITH (security_invoker = true) AS
		SELECT e.tenant_id, e.created_at AS occurred_at, 'session_edit'::text AS source,
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
		SELECT saa.tenant_id, saa.changed_at, 'absence'::text, saa.id, sa.staff_id,
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
		SELECT ba.tenant_id, ba.decided_at, 'adjustment'::text, ba.id, ba.staff_id,
			ARRAY[ba.staff_id], ba.decided_by, FALSE, ba.note::text,
			jsonb_build_object(
				'adjustment_id', ba.id, 'type', ba.type,
				'minutes_delta', ba.minutes_delta,
				'effective_date', to_char(ba.effective_date, 'YYYY-MM-DD')
			)
		FROM active.staff_balance_adjustments ba
		UNION ALL
		SELECT s.tenant_id, s.closed_at, 'month_close'::text, MIN(s.id), NULL::bigint,
			array_agg(s.staff_id), s.closed_by, FALSE, s.close_reason::text,
			jsonb_build_object('year', s.year, 'month', s.month, 'account_count', COUNT(*),
				'by_traeger', s.source = 'traeger')
		FROM active.staff_month_balance_snapshots s
		GROUP BY s.tenant_id, s.closed_at, s.closed_by, s.year, s.month, s.close_reason, s.source
		UNION ALL
		SELECT s.tenant_id, s.reopened_at, 'month_reopen'::text, s.id, s.staff_id,
			ARRAY[s.staff_id], s.reopened_by, FALSE, s.reopen_reason::text,
			jsonb_build_object(
				'year', s.year, 'month', s.month,
				'closing_balance_minutes', s.closing_balance_minutes,
				'by_traeger', s.source = 'traeger'
			)
		FROM active.staff_month_balance_snapshots s
		WHERE s.reopened_at IS NOT NULL
		UNION ALL
		SELECT d.tenant_id, d.occurred_at, 'deletion'::text, d.id, d.staff_id,
			ARRAY[d.staff_id], d.deleted_by, FALSE, d.note::text,
			jsonb_build_object(
				'deleted_source', d.source, 'source_id', d.source_id, 'payload', d.payload
			)
		FROM audit.time_tracking_deletions d
		UNION ALL
		SELECT vo.tenant_id, vo.decided_at, 'vacation_opening'::text, vo.id, vo.staff_id,
			ARRAY[vo.staff_id], vo.decided_by, FALSE, vo.note::text,
			jsonb_build_object(
				'opening_id', vo.id, 'year', vo.year,
				'effective_date', to_char(vo.effective_date, 'YYYY-MM-DD'),
				'taken_before_days', vo.taken_before_days,
				'entered_remaining_days', vo.entered_remaining_days
			)
		FROM active.staff_vacation_openings vo
		UNION ALL
		SELECT c.tenant_id, c.created_at, 'absence_type_allowance'::text, c.id, c.staff_id,
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
		SELECT c.tenant_id, c.occurred_at, 'personnel_number'::text, c.id, c.staff_id,
			ARRAY[c.staff_id], c.changed_by, FALSE, c.note::text,
			jsonb_build_object('old_value', c.old_value, 'new_value', c.new_value)
		FROM audit.personnel_number_changes c
		UNION ALL
		SELECT q.tenant_id, q.created_at, 'vacation_quota'::text, q.id, q.staff_id,
			ARRAY[q.staff_id], q.changed_by, FALSE, q.reason::text,
			jsonb_build_object(
				'year', q.year,
				'old_entitled_days', q.old_entitled_days, 'new_entitled_days', q.new_entitled_days,
				'old_carryover_days', q.old_carryover_days, 'new_carryover_days', q.new_carryover_days
			)
		FROM active.staff_vacation_quota_changes q;

		GRANT SELECT ON audit.time_tracking_audit_log TO phoenix_tenant;
`

// traegerMonthCloseDownSQL removes the closes of the Träger first: the school
// had none before, and its columns cannot hold them.
const traegerMonthCloseDownSQL = `
DELETE FROM active.staff_month_balance_snapshots WHERE source = 'traeger';
`

// traegerMonthCloseDownAuditLogView is staffOwnerAuditLogView, the view
// before this migration, spelled out so the migration resolves statically.
const traegerMonthCloseDownAuditLogView = `
		CREATE OR REPLACE VIEW audit.time_tracking_audit_log WITH (security_invoker = true) AS
		SELECT e.tenant_id, e.created_at AS occurred_at, 'session_edit'::text AS source,
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
		SELECT saa.tenant_id, saa.changed_at, 'absence'::text, saa.id, sa.staff_id,
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
		SELECT ba.tenant_id, ba.decided_at, 'adjustment'::text, ba.id, ba.staff_id,
			ARRAY[ba.staff_id], ba.decided_by, FALSE, ba.note::text,
			jsonb_build_object(
				'adjustment_id', ba.id, 'type', ba.type,
				'minutes_delta', ba.minutes_delta,
				'effective_date', to_char(ba.effective_date, 'YYYY-MM-DD')
			)
		FROM active.staff_balance_adjustments ba
		UNION ALL
		SELECT s.tenant_id, s.closed_at, 'month_close'::text, MIN(s.id), NULL::bigint,
			array_agg(s.staff_id), s.closed_by, FALSE, s.close_reason::text,
			jsonb_build_object('year', s.year, 'month', s.month, 'account_count', COUNT(*))
		FROM active.staff_month_balance_snapshots s
		GROUP BY s.tenant_id, s.closed_at, s.closed_by, s.year, s.month, s.close_reason
		UNION ALL
		SELECT s.tenant_id, s.reopened_at, 'month_reopen'::text, s.id, s.staff_id,
			ARRAY[s.staff_id], s.reopened_by, FALSE, s.reopen_reason::text,
			jsonb_build_object(
				'year', s.year, 'month', s.month,
				'closing_balance_minutes', s.closing_balance_minutes
			)
		FROM active.staff_month_balance_snapshots s
		WHERE s.reopened_at IS NOT NULL
		UNION ALL
		SELECT d.tenant_id, d.occurred_at, 'deletion'::text, d.id, d.staff_id,
			ARRAY[d.staff_id], d.deleted_by, FALSE, d.note::text,
			jsonb_build_object(
				'deleted_source', d.source, 'source_id', d.source_id, 'payload', d.payload
			)
		FROM audit.time_tracking_deletions d
		UNION ALL
		SELECT vo.tenant_id, vo.decided_at, 'vacation_opening'::text, vo.id, vo.staff_id,
			ARRAY[vo.staff_id], vo.decided_by, FALSE, vo.note::text,
			jsonb_build_object(
				'opening_id', vo.id, 'year', vo.year,
				'effective_date', to_char(vo.effective_date, 'YYYY-MM-DD'),
				'taken_before_days', vo.taken_before_days,
				'entered_remaining_days', vo.entered_remaining_days
			)
		FROM active.staff_vacation_openings vo
		UNION ALL
		SELECT c.tenant_id, c.created_at, 'absence_type_allowance'::text, c.id, c.staff_id,
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
		SELECT c.tenant_id, c.occurred_at, 'personnel_number'::text, c.id, c.staff_id,
			ARRAY[c.staff_id], c.changed_by, FALSE, c.note::text,
			jsonb_build_object('old_value', c.old_value, 'new_value', c.new_value)
		FROM audit.personnel_number_changes c
		UNION ALL
		SELECT q.tenant_id, q.created_at, 'vacation_quota'::text, q.id, q.staff_id,
			ARRAY[q.staff_id], q.changed_by, FALSE, q.reason::text,
			jsonb_build_object(
				'year', q.year,
				'old_entitled_days', q.old_entitled_days, 'new_entitled_days', q.new_entitled_days,
				'old_carryover_days', q.old_carryover_days, 'new_carryover_days', q.new_carryover_days
			)
		FROM active.staff_vacation_quota_changes q;

		GRANT SELECT ON audit.time_tracking_audit_log TO phoenix_tenant;
`

// traegerMonthCloseDownTableSQL restores the columns and checks after the
// view no longer reads source.
const traegerMonthCloseDownTableSQL = `
ALTER TABLE active.staff_month_balance_snapshots
	DROP CONSTRAINT chk_smbs_reopen,
	ADD CONSTRAINT chk_smbs_reopen CHECK ((reopened_at IS NULL) = (reopened_by IS NULL)),
	DROP CONSTRAINT chk_smbs_closer,
	DROP CONSTRAINT chk_smbs_source,
	ADD CONSTRAINT chk_smbs_source CHECK (source IN ('admin','scheduler','migration')),
	DROP COLUMN reopened_by_account_id,
	DROP COLUMN closed_by_account_id,
	ALTER COLUMN closed_by SET NOT NULL;
`

func traegerMonthCloseUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerMonthCloseUpSQL); err != nil {
			return fmt.Errorf("add the month close of the traeger: %w", err)
		}
		if _, err := tx.ExecContext(ctx, traegerMonthCloseAuditLogView); err != nil {
			return fmt.Errorf("mark the closes of the traeger in the audit view: %w", err)
		}
		return nil
	})
}

func traegerMonthCloseDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerMonthCloseDownSQL); err != nil {
			return fmt.Errorf("drop the closes of the traeger: %w", err)
		}
		if _, err := tx.ExecContext(ctx, traegerMonthCloseDownAuditLogView); err != nil {
			return fmt.Errorf("restore the audit view: %w", err)
		}
		if _, err := tx.ExecContext(ctx, traegerMonthCloseDownTableSQL); err != nil {
			return fmt.Errorf("drop the month close of the traeger: %w", err)
		}
		return nil
	})
}
