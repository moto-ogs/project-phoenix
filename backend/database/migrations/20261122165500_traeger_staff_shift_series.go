package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerStaffShiftSeriesVersion = "20261122165500"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerStaffShiftSeriesVersion,
		Description: "Dienstplan: Serien des Träger-Büros ohne Personal-Datensatz der Schule (#7818, ADR 0084 §5)",
		DependsOn: []string{
			staffShiftSeriesVersion,     // schedule.staff_shift_series and its exceptions
			traegerStaffPlanningVersion, // schedule.staff_shifts.planned_by_traeger, the mark this one follows
		},
	})
	Migrations.MustRegister(traegerStaffShiftSeriesUp, traegerStaffShiftSeriesDown)
}

// traegerStaffShiftSeriesUpSQL lets a person of the Träger-Büro plan shift
// series in the Dienstplan of a school they opened through the Absprung
// (#7818). Such a session holds the school's admin role and no staff record
// of the school (ADR 0084 section 5). As for schedule.staff_shifts
// .planned_by_traeger (#4708), a series the Träger-Büro planned carries a
// mark of its own, and created_by is NULL for it and only for it. An
// exception records a removed occurrence under the author of that
// occurrence, so the exception of a marked series carries the mark as well.
//
// A staff-authored row still needs its staff member: the checks only accept
// a missing author together with the mark, and never the mark beside a staff
// author. created_by keeps its tenant-scoped foreign key, which a NULL
// passes.
const traegerStaffShiftSeriesUpSQL = `
ALTER TABLE schedule.staff_shift_series
	ADD COLUMN planned_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ALTER COLUMN created_by DROP NOT NULL,
	ADD CONSTRAINT chk_staff_shift_series_author CHECK ((created_by IS NOT NULL) <> planned_by_traeger);

ALTER TABLE schedule.staff_shift_series_exceptions
	ADD COLUMN planned_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ALTER COLUMN created_by DROP NOT NULL,
	ADD CONSTRAINT chk_staff_shift_series_exceptions_author CHECK ((created_by IS NOT NULL) <> planned_by_traeger);

COMMENT ON COLUMN schedule.staff_shift_series.planned_by_traeger IS
	'A person of the Träger-Büro planned the series in a school session opened through the Absprung (#7818, ADR 0084 section 5); created_by is then NULL.';
COMMENT ON COLUMN schedule.staff_shift_series_exceptions.planned_by_traeger IS
	'The removed occurrence belonged to a series the Träger-Büro planned (#7818); created_by is then NULL.';
`

// traegerStaffShiftSeriesLockSQL closes the tables to writers before the
// down migration counts: a write still open at the count would commit unseen.
const traegerStaffShiftSeriesLockSQL = `
LOCK TABLE schedule.staff_shift_series, schedule.staff_shift_series_exceptions IN ACCESS EXCLUSIVE MODE
`

// traegerStaffShiftSeriesEntriesSQL counts what the Träger-Büro planned.
const traegerStaffShiftSeriesEntriesSQL = `
SELECT
	(SELECT COUNT(*) FROM schedule.staff_shift_series WHERE planned_by_traeger)
	+ (SELECT COUNT(*) FROM schedule.staff_shift_series_exceptions WHERE planned_by_traeger)
`

// The shape before this migration cannot hold a series without a staff
// author. Deleting such a series would take its materialized shifts with it
// and let a later re-plan regenerate occurrences that were removed, so the
// down migration only runs while no such row exists.
const traegerStaffShiftSeriesDownSQL = `
ALTER TABLE schedule.staff_shift_series_exceptions
	DROP CONSTRAINT IF EXISTS chk_staff_shift_series_exceptions_author,
	DROP COLUMN IF EXISTS planned_by_traeger,
	ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE schedule.staff_shift_series
	DROP CONSTRAINT IF EXISTS chk_staff_shift_series_author,
	DROP COLUMN IF EXISTS planned_by_traeger,
	ALTER COLUMN created_by SET NOT NULL;
`

func traegerStaffShiftSeriesUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffShiftSeriesUpSQL); err != nil {
			return fmt.Errorf("add the Träger-Büro author of shift series: %w", err)
		}
		return nil
	})
}

func traegerStaffShiftSeriesDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffShiftSeriesLockSQL); err != nil {
			return fmt.Errorf("lock the shift series for the rollback: %w", err)
		}
		var entries int
		if err := tx.NewRaw(traegerStaffShiftSeriesEntriesSQL).Scan(ctx, &entries); err != nil {
			return fmt.Errorf("count the shift series the Träger-Büro planned: %w", err)
		}
		if entries > 0 {
			return fmt.Errorf("migration %s cannot be rolled back while %d shift series rows of the Träger-Büro exist; restore the release database backup and matching images", traegerStaffShiftSeriesVersion, entries)
		}
		if _, err := tx.ExecContext(ctx, traegerStaffShiftSeriesDownSQL); err != nil {
			return fmt.Errorf("drop the Träger-Büro author of shift series: %w", err)
		}
		return nil
	})
}
