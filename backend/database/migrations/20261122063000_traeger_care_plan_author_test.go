package migrations

import (
	"strings"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// Migration 20261122063000 lets the Träger-Büro enter Betreuungszeiten without
// a staff record of the school (#7766). Its checks are the model: a row
// without a staff author needs the mark of the Träger-Büro, and only that
// mark replaces the author.
func TestTraegerCarePlanAuthorConstraints(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Mila", "Traegerzeit", "3a")

	inserts := []struct {
		name, constraint, sql string
	}{
		{"arrival schedule", "chk_student_arrival_schedules_author", `
			INSERT INTO schedule.student_arrival_schedules (tenant_id, student_id, weekday, expected_arrival, entered_by_traeger)
			VALUES (?, ?, 1, '11:30', ?)`},
		{"arrival note", "chk_student_arrival_notes_author", `
			INSERT INTO schedule.student_arrival_notes (tenant_id, student_id, note_date, content, entered_by_traeger)
			VALUES (?, ?, '2026-09-09', 'kommt später', ?)`},
		{"pickup note", "chk_student_pickup_notes_author", `
			INSERT INTO schedule.student_pickup_notes (tenant_id, student_id, note_date, content, entered_by_traeger)
			VALUES (?, ?, '2026-09-09', 'Oma holt ab', ?)`},
		{"pickup schedule", "student_pickup_schedules_source_check", `
			INSERT INTO schedule.student_pickup_schedules (tenant_id, student_id, weekday, pickup_time, entered_by_traeger)
			VALUES (?, ?, 1, '14:00', ?)`},
		{"arrival exception", "chk_exception_author", `
			INSERT INTO schedule.student_arrival_exceptions (tenant_id, student_id, exception_date, expected_arrival, entered_by_traeger)
			VALUES (?, ?, '2026-09-09', '12:00', ?)`},
		{"pickup exception", "chk_exception_author", `
			INSERT INTO schedule.student_pickup_exceptions (tenant_id, student_id, exception_date, pickup_time, entered_by_traeger)
			VALUES (?, ?, '2026-09-09', '13:00', ?)`},
	}
	for _, insert := range inserts {
		_, err := db.ExecContext(ctx, insert.sql, tenantID, student.ID, false)
		require.ErrorContains(t, err, insert.constraint, "%s without author and without mark", insert.name)
		_, err = db.ExecContext(ctx, insert.sql, tenantID, student.ID, true)
		require.NoError(t, err, "%s entered by the Träger-Büro", insert.name)
		table := strings.Fields(insert.sql)[2]
		_, err = db.ExecContext(ctx, "UPDATE "+table+" SET created_by = 1 WHERE tenant_id = ? AND student_id = ?", tenantID, student.ID)
		require.ErrorContains(t, err, insert.constraint, "%s with a staff author beside the mark", insert.name)
	}

	// A manual partial absence needs its staff member or the mark of the
	// Träger-Büro; the mark never rides on a row without a partial absence.
	excuse := func(byTraeger bool) error {
		_, err := db.ExecContext(ctx, `
			UPDATE schedule.student_pickup_exceptions
			SET excused_from = '12:00', excused_by_traeger = ?
			WHERE tenant_id = ? AND student_id = ?`, byTraeger, tenantID, student.ID)
		return err
	}
	require.ErrorContains(t, excuse(false), "chk_pickup_exception_partial_absence")
	require.NoError(t, excuse(true))
	_, err := db.ExecContext(ctx, `
		UPDATE schedule.student_pickup_exceptions SET excused_created_by = 1
		WHERE tenant_id = ? AND student_id = ?`, tenantID, student.ID)
	require.ErrorContains(t, err, "chk_pickup_exception_partial_absence", "a staff member beside the mark of the partial absence")
	_, err = db.ExecContext(ctx, `
		INSERT INTO schedule.student_departure_exceptions (tenant_id, student_id, exception_date, departure_mode, created_by, entered_by_traeger)
		VALUES (?, ?, '2026-09-09', 'pickup', 1, TRUE)`, tenantID, student.ID)
	require.ErrorContains(t, err, "chk_departure_exception_author")
	_, err = db.ExecContext(ctx, `
		UPDATE schedule.student_pickup_exceptions SET excused_from = NULL
		WHERE tenant_id = ? AND student_id = ?`, tenantID, student.ID)
	require.ErrorContains(t, err, "chk_pickup_exception_partial_absence")
}

// A care exit archived before the migration has snapshots without the new
// marks. The migration adds them, so that resuming care can restore the rows:
// jsonb_populate_record leaves an unnamed column NULL, and the marks are NOT
// NULL.
func TestTraegerCarePlanAuthorBackfillsCareExitSnapshots(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Jonas", "Altbestand", "2b")

	_, err := db.ExecContext(ctx, `
		INSERT INTO users.student_care_exit_source_removals (tenant_id, student_id, kind, source_row_id, was_deleted, snapshot)
		VALUES
			(?, ?, 'pickup_exception', 1, TRUE, '{"reason": "vor der Migration"}'::jsonb),
			(?, ?, 'arrival_schedule', 2, TRUE, '{"entered_by_traeger": true}'::jsonb),
			(?, ?, 'source_booking', 3, TRUE, '{}'::jsonb)`,
		tenantID, student.ID, tenantID, student.ID, tenantID, student.ID)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, traegerCarePlanAuthorSnapshotsSQL)
	require.NoError(t, err)

	snapshots := map[string]string{}
	rows := []struct {
		Kind     string `bun:"kind"`
		Snapshot string `bun:"snapshot"`
	}{}
	require.NoError(t, db.NewRaw(`
		SELECT kind, snapshot::text AS snapshot FROM users.student_care_exit_source_removals
		WHERE tenant_id = ? AND student_id = ?`, tenantID, student.ID).Scan(ctx, &rows))
	for _, row := range rows {
		snapshots[row.Kind] = row.Snapshot
	}
	require.JSONEq(t, `{"reason": "vor der Migration", "entered_by_traeger": false, "excused_by_traeger": false}`, snapshots["pickup_exception"])
	require.JSONEq(t, `{"entered_by_traeger": true}`, snapshots["arrival_schedule"], "a mark the snapshot already has wins")
	require.JSONEq(t, `{}`, snapshots["source_booking"], "a booking has no author")

	// What resuming care does with the snapshot: both marks come back set.
	var restored struct {
		Entered *bool `bun:"entered"`
		Excused *bool `bun:"excused"`
	}
	require.NoError(t, db.NewRaw(`
		SELECT (r).entered_by_traeger AS entered, (r).excused_by_traeger AS excused
		FROM (
			SELECT jsonb_populate_record(NULL::schedule.student_pickup_exceptions, snapshot) AS r
			FROM users.student_care_exit_source_removals
			WHERE tenant_id = ? AND student_id = ? AND kind = 'pickup_exception'
		) restored`, tenantID, student.ID).Scan(ctx, &restored))
	require.NotNil(t, restored.Entered)
	require.NotNil(t, restored.Excused)
	require.False(t, *restored.Entered)
	require.False(t, *restored.Excused)
}

// The shapes before the migration cannot hold what the Träger-Büro entered.
// Rolling back while such an entry exists would have to delete care data, so
// the down migration refuses and leaves every row as it is: for a live row,
// for a row only a care exit archived, and not at all once none is left.
func TestTraegerCarePlanAuthorDownRefusesWhileTraegerEntriesExist(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Lena", "Rueckweg", "1c")
	marked := func() (count int) {
		require.NoError(t, db.NewRaw(traegerCarePlanAuthorEntriesSQL).Scan(ctx, &count))
		return count
	}
	require.Zero(t, marked(), "the isolated database starts without entries of the Träger-Büro")

	_, err := db.ExecContext(ctx, `
		INSERT INTO schedule.student_departure_exceptions (tenant_id, student_id, exception_date, departure_mode, entered_by_traeger)
		VALUES (?, ?, '2026-09-09', 'pickup', TRUE)`, tenantID, student.ID)
	require.NoError(t, err)
	require.ErrorContains(t, traegerCarePlanAuthorDown(ctx, db), "cannot be rolled back")
	require.Equal(t, 1, marked(), "the refused rollback keeps the row and its mark")

	_, err = db.ExecContext(ctx, `DELETE FROM schedule.student_departure_exceptions WHERE tenant_id = ?`, tenantID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO users.student_care_exit_source_removals (tenant_id, student_id, kind, source_row_id, was_deleted, snapshot)
		VALUES (?, ?, 'pickup_exception', 1, TRUE, '{"entered_by_traeger": false, "excused_by_traeger": true}'::jsonb)`, tenantID, student.ID)
	require.NoError(t, err)
	require.ErrorContains(t, traegerCarePlanAuthorDown(ctx, db), "cannot be rolled back")

	_, err = db.ExecContext(ctx, `DELETE FROM users.student_care_exit_source_removals WHERE tenant_id = ?`, tenantID)
	require.NoError(t, err)
	require.NoError(t, traegerCarePlanAuthorDown(ctx, db))
	_, err = db.ExecContext(ctx, `
		INSERT INTO schedule.student_arrival_schedules (tenant_id, student_id, weekday, expected_arrival)
		VALUES (?, ?, 1, '11:30')`, tenantID, student.ID)
	require.ErrorContains(t, err, "created_by", "the old shape requires the staff author again")
}
