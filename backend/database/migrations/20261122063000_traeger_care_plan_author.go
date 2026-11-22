package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerCarePlanAuthorVersion = "20261122063000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerCarePlanAuthorVersion,
		Description: "Betreuungszeiten: Einträge des Träger-Büros ohne Personal-Datensatz der Schule (#7766, ADR 0084 §5)",
		DependsOn: []string{
			createArrivalSchedulesVersion,        // schedule.student_arrival_schedules and student_arrival_notes
			addPickupNotesVersion,                // schedule.student_pickup_notes
			careOfferingPickupTimesVersion,       // student_pickup_schedules_source_check
			autoPartialAbsenceVersion,            // chk_pickup_exception_partial_absence
			studentDepartureExceptionsVersion,    // schedule.student_departure_exceptions
			holidayBookingExceptionSourceVersion, // chk_exception_author
			careWithdrawalCompletionsVersion,     // users.student_care_exit_source_removals
		},
	})
	Migrations.MustRegister(traegerCarePlanAuthorUp, traegerCarePlanAuthorDown)
}

// traegerCarePlanAuthorUpSQL lets a person of the Träger-Büro enter
// Betreuungszeiten in a school they opened through the Absprung (#7766).
//
// Such a session carries the school's admin role and no staff record of the
// school (ADR 0084 section 5: no membership is created, the person acts as
// themselves). Every author column of the weekly plan points at a staff
// member, so each save was refused. As for schedule.staff_shifts
// .planned_by_traeger (#4708), a row the Träger-Büro entered carries a mark
// of its own, and created_by may be NULL for it and only for it:
//
//   - entered_by_traeger on the weekly arrival and pickup times, their
//     day exceptions, their notes and the day's way home.
//   - excused_by_traeger on a pickup exception whose partial absence the
//     Träger-Büro entered; excused_created_by is NULL for it.
//
// A staff-authored row still needs its staff member: the checks only accept
// a missing author together with the mark.
const traegerCarePlanAuthorUpSQL = `
ALTER TABLE schedule.student_arrival_schedules
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ALTER COLUMN created_by DROP NOT NULL,
	ADD CONSTRAINT chk_student_arrival_schedules_author CHECK (created_by IS NOT NULL OR entered_by_traeger);

ALTER TABLE schedule.student_arrival_notes
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ALTER COLUMN created_by DROP NOT NULL,
	ADD CONSTRAINT chk_student_arrival_notes_author CHECK (created_by IS NOT NULL OR entered_by_traeger);

ALTER TABLE schedule.student_pickup_notes
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ALTER COLUMN created_by DROP NOT NULL,
	ADD CONSTRAINT chk_student_pickup_notes_author CHECK (created_by IS NOT NULL OR entered_by_traeger);

ALTER TABLE schedule.student_pickup_schedules
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false,
	DROP CONSTRAINT IF EXISTS student_pickup_schedules_source_check,
	ADD CONSTRAINT student_pickup_schedules_source_check CHECK (
		source IN ('staff', 'care_offering')
		AND (source = 'care_offering' OR created_by IS NOT NULL OR entered_by_traeger)
	);

ALTER TABLE schedule.student_arrival_exceptions
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false,
	DROP CONSTRAINT IF EXISTS chk_exception_author,
	ADD CONSTRAINT chk_exception_author CHECK (
		(source = 'staff' AND (created_by IS NOT NULL OR entered_by_traeger))
		OR source = 'guardian'
		OR source = 'holiday_booking'
	);

ALTER TABLE schedule.student_pickup_exceptions
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN excused_by_traeger BOOLEAN NOT NULL DEFAULT false,
	DROP CONSTRAINT IF EXISTS chk_exception_author,
	ADD CONSTRAINT chk_exception_author CHECK (
		(source = 'staff' AND (created_by IS NOT NULL OR entered_by_traeger))
		OR source = 'guardian'
		OR source = 'holiday_booking'
	),
	DROP CONSTRAINT IF EXISTS chk_pickup_exception_partial_absence,
	ADD CONSTRAINT chk_pickup_exception_partial_absence CHECK (
		(excused_from IS NULL AND excused_reason IS NULL AND excused_created_by IS NULL AND NOT excused_by_traeger AND NOT excused_owns_pickup_time AND NOT excused_auto)
		OR (excused_from IS NOT NULL AND excused_auto AND excused_created_by IS NULL AND NOT excused_by_traeger AND NOT excused_owns_pickup_time AND pickup_time IS NOT NULL)
		OR (excused_from IS NOT NULL AND NOT excused_auto AND (excused_created_by IS NOT NULL OR excused_by_traeger) AND (NOT excused_owns_pickup_time OR pickup_time IS NOT NULL))
	);

ALTER TABLE schedule.student_departure_exceptions
	ADD COLUMN entered_by_traeger BOOLEAN NOT NULL DEFAULT false;

` + traegerCarePlanAuthorSnapshotsSQL + `
COMMENT ON COLUMN schedule.student_arrival_schedules.entered_by_traeger IS
	'A person of the Träger-Büro entered the row in a school session opened through the Absprung (#7766, ADR 0084 section 5); created_by is then NULL.';
COMMENT ON COLUMN schedule.student_arrival_notes.entered_by_traeger IS
	'A person of the Träger-Büro entered the row (#7766); created_by is then NULL.';
COMMENT ON COLUMN schedule.student_pickup_notes.entered_by_traeger IS
	'A person of the Träger-Büro entered the row (#7766); created_by is then NULL.';
COMMENT ON COLUMN schedule.student_pickup_schedules.entered_by_traeger IS
	'A person of the Träger-Büro entered the row (#7766); created_by is then NULL.';
COMMENT ON COLUMN schedule.student_arrival_exceptions.entered_by_traeger IS
	'A person of the Träger-Büro entered the row (#7766); created_by is then NULL.';
COMMENT ON COLUMN schedule.student_pickup_exceptions.entered_by_traeger IS
	'A person of the Träger-Büro entered the row (#7766); created_by is then NULL.';
COMMENT ON COLUMN schedule.student_pickup_exceptions.excused_by_traeger IS
	'A person of the Träger-Büro entered the partial absence (#7766); excused_created_by is then NULL.';
COMMENT ON COLUMN schedule.student_departure_exceptions.entered_by_traeger IS
	'A person of the Träger-Büro entered the row (#7766); created_by is then NULL.';
`

// traegerCarePlanAuthorSnapshotsSQL gives the rows a care exit archived before
// this migration the new marks. Resuming care restores a row from its
// snapshot with jsonb_populate_record, which leaves a column the snapshot
// does not name NULL: without the marks the restore would break the NOT NULL
// of the new columns. A key the snapshot already has wins.
const traegerCarePlanAuthorSnapshotsSQL = `
UPDATE users.student_care_exit_source_removals
	SET snapshot = jsonb_build_object('entered_by_traeger', false) || snapshot
	WHERE kind IN ('pickup_schedule', 'arrival_schedule', 'pickup_exception', 'arrival_exception', 'departure_exception')
		AND jsonb_typeof(snapshot) = 'object'
		AND NOT snapshot ? 'entered_by_traeger';
UPDATE users.student_care_exit_source_removals
	SET snapshot = jsonb_build_object('excused_by_traeger', false) || snapshot
	WHERE kind = 'pickup_exception'
		AND jsonb_typeof(snapshot) = 'object'
		AND NOT snapshot ? 'excused_by_traeger';
`

// The shapes before this migration cannot hold a row without a staff author:
// the down migration deletes what the Träger-Büro entered, live and archived
// by a care exit, as the down migrations of 1.15.297 and 20261115180000
// delete their author-less rows.
const traegerCarePlanAuthorDownSQL = `
DELETE FROM users.student_care_exit_source_removals
	WHERE kind IN ('pickup_schedule', 'arrival_schedule', 'pickup_exception', 'arrival_exception', 'departure_exception')
		AND jsonb_typeof(snapshot) = 'object'
		AND (snapshot ->> 'entered_by_traeger' = 'true' OR snapshot ->> 'excused_by_traeger' = 'true');
DELETE FROM schedule.student_arrival_schedules WHERE created_by IS NULL;
DELETE FROM schedule.student_arrival_notes WHERE created_by IS NULL;
DELETE FROM schedule.student_pickup_notes WHERE created_by IS NULL;
DELETE FROM schedule.student_pickup_schedules WHERE created_by IS NULL AND source = 'staff';
DELETE FROM schedule.student_arrival_exceptions WHERE created_by IS NULL AND source = 'staff';
DELETE FROM schedule.student_pickup_exceptions WHERE created_by IS NULL AND source = 'staff';
UPDATE schedule.student_pickup_exceptions
	SET excused_from = NULL, excused_reason = NULL, excused_owns_pickup_time = false, excused_by_traeger = false
	WHERE excused_by_traeger;

ALTER TABLE schedule.student_departure_exceptions
	DROP COLUMN IF EXISTS entered_by_traeger;

ALTER TABLE schedule.student_pickup_exceptions
	DROP CONSTRAINT IF EXISTS chk_pickup_exception_partial_absence,
	DROP CONSTRAINT IF EXISTS chk_exception_author,
	DROP COLUMN IF EXISTS excused_by_traeger,
	DROP COLUMN IF EXISTS entered_by_traeger,
	ADD CONSTRAINT chk_exception_author CHECK (
		(source = 'staff' AND created_by IS NOT NULL)
		OR source = 'guardian'
		OR source = 'holiday_booking'
	),
	ADD CONSTRAINT chk_pickup_exception_partial_absence CHECK (
		(excused_from IS NULL AND excused_reason IS NULL AND excused_created_by IS NULL AND NOT excused_owns_pickup_time AND NOT excused_auto)
		OR (excused_from IS NOT NULL AND excused_auto AND excused_created_by IS NULL AND NOT excused_owns_pickup_time AND pickup_time IS NOT NULL)
		OR (excused_from IS NOT NULL AND NOT excused_auto AND excused_created_by IS NOT NULL AND (NOT excused_owns_pickup_time OR pickup_time IS NOT NULL))
	);

ALTER TABLE schedule.student_arrival_exceptions
	DROP CONSTRAINT IF EXISTS chk_exception_author,
	DROP COLUMN IF EXISTS entered_by_traeger,
	ADD CONSTRAINT chk_exception_author CHECK (
		(source = 'staff' AND created_by IS NOT NULL)
		OR source = 'guardian'
		OR source = 'holiday_booking'
	);

ALTER TABLE schedule.student_pickup_schedules
	DROP CONSTRAINT IF EXISTS student_pickup_schedules_source_check,
	DROP COLUMN IF EXISTS entered_by_traeger,
	ADD CONSTRAINT student_pickup_schedules_source_check CHECK (
		source IN ('staff', 'care_offering')
		AND (source = 'care_offering' OR created_by IS NOT NULL)
	);

ALTER TABLE schedule.student_pickup_notes
	DROP CONSTRAINT IF EXISTS chk_student_pickup_notes_author,
	DROP COLUMN IF EXISTS entered_by_traeger,
	ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE schedule.student_arrival_notes
	DROP CONSTRAINT IF EXISTS chk_student_arrival_notes_author,
	DROP COLUMN IF EXISTS entered_by_traeger,
	ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE schedule.student_arrival_schedules
	DROP CONSTRAINT IF EXISTS chk_student_arrival_schedules_author,
	DROP COLUMN IF EXISTS entered_by_traeger,
	ALTER COLUMN created_by SET NOT NULL;
`

func traegerCarePlanAuthorUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerCarePlanAuthorUpSQL); err != nil {
			return fmt.Errorf("add the Träger-Büro author of Betreuungszeiten: %w", err)
		}
		return nil
	})
}

func traegerCarePlanAuthorDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerCarePlanAuthorDownSQL); err != nil {
			return fmt.Errorf("drop the Träger-Büro author of Betreuungszeiten: %w", err)
		}
		return nil
	})
}
