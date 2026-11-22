package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const enrollmentWeeklyPlanByTraegerVersion = "20261122165000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     enrollmentWeeklyPlanByTraegerVersion,
		Description: "Anmeldungen: geplanter Wochenplan einer Freigabe des Träger-Büros ohne Personal-Datensatz der Schule (#7818, ADR 0084 §5)",
		DependsOn:   []string{requestChildWeeklyPlanOnVersion}, // enrollment.request_children.weekly_plan_author
	})
	Migrations.MustRegister(enrollmentWeeklyPlanByTraegerUp, enrollmentWeeklyPlanByTraegerDown)
}

// enrollmentWeeklyPlanByTraegerUpSQL lets a person of the Träger-Büro approve
// a renewal before its care starts in a school they opened through the
// Absprung (#7818). The approval stores the author of the weekly rows the
// start writes in weekly_plan_author, a staff member. Such a session has no
// staff record of the school, so the plan carries the mark of the Träger-Büro
// instead, and the start writes its rows with entered_by_traeger (#7766).
// The mark never stands beside a staff author.
const enrollmentWeeklyPlanByTraegerUpSQL = `
ALTER TABLE enrollment.request_children
	ADD COLUMN weekly_plan_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ADD CONSTRAINT chk_request_children_weekly_plan_author
		CHECK (NOT (weekly_plan_author IS NOT NULL AND weekly_plan_by_traeger));

COMMENT ON COLUMN enrollment.request_children.weekly_plan_by_traeger IS
	'A person of the Träger-Büro without a staff record stored the planned weekly plan (#7818, ADR 0084 section 5); the start writes its weekly rows with entered_by_traeger, and weekly_plan_author is NULL.';
`

// enrollmentWeeklyPlanByTraegerLockSQL closes the table to writers before the
// down migration counts: an approval still open at the count would commit a
// marked plan unseen.
const enrollmentWeeklyPlanByTraegerLockSQL = `LOCK TABLE enrollment.request_children IN ACCESS EXCLUSIVE MODE`

// enrollmentWeeklyPlanByTraegerEntriesSQL counts the plans the Träger-Büro
// stored.
const enrollmentWeeklyPlanByTraegerEntriesSQL = `SELECT COUNT(*) FROM enrollment.request_children WHERE weekly_plan_by_traeger`

// Without the mark a stored plan of the Träger-Büro would read as a plan
// without author, and the start would fail on it every day. So the down
// migration only runs while no such plan exists.
const enrollmentWeeklyPlanByTraegerDownSQL = `
ALTER TABLE enrollment.request_children
	DROP CONSTRAINT IF EXISTS chk_request_children_weekly_plan_author,
	DROP COLUMN IF EXISTS weekly_plan_by_traeger;
`

func enrollmentWeeklyPlanByTraegerUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, enrollmentWeeklyPlanByTraegerUpSQL); err != nil {
			return fmt.Errorf("add the Träger-Büro author of planned weekly plans: %w", err)
		}
		return nil
	})
}

func enrollmentWeeklyPlanByTraegerDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, enrollmentWeeklyPlanByTraegerLockSQL); err != nil {
			return fmt.Errorf("lock enrollment.request_children for the rollback: %w", err)
		}
		var entries int
		if err := tx.NewRaw(enrollmentWeeklyPlanByTraegerEntriesSQL).Scan(ctx, &entries); err != nil {
			return fmt.Errorf("count the weekly plans the Träger-Büro stored: %w", err)
		}
		if entries > 0 {
			return fmt.Errorf("migration %s cannot be rolled back while %d weekly plans of the Träger-Büro are planned; restore the release database backup and matching images", enrollmentWeeklyPlanByTraegerVersion, entries)
		}
		if _, err := tx.ExecContext(ctx, enrollmentWeeklyPlanByTraegerDownSQL); err != nil {
			return fmt.Errorf("drop the Träger-Büro author of planned weekly plans: %w", err)
		}
		return nil
	})
}
