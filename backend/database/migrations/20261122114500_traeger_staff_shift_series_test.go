package migrations

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// Migration 20261122114500 lets the Träger-Büro plan shift series without a
// staff record of the school (#7818). Its checks are the model: a series or
// exception without a staff author needs the mark of the Träger-Büro, and
// only that mark replaces the author.
func TestTraegerStaffShiftSeriesAuthorConstraints(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Mira", "Serie")
	period := testpkg.CreateTestCalendarPeriod(t, db, fmt.Sprintf("Traeger-Serie-%d", testpkg.UniqueSuffix()),
		testpkg.Date(2030, time.August, 1), testpkg.Date(2031, time.July, 31))

	insertSeries := func(createdBy *int64, marked bool) (int64, error) {
		var id int64
		err := db.NewRaw(`
			INSERT INTO schedule.staff_shift_series (
				tenant_id, staff_id, weekdays, start_time, end_time, calendar_period_id, valid_from, created_by, planned_by_traeger
			) VALUES (?, ?, '{1}'::smallint[], '08:00', '12:00', ?, '2030-09-02', ?, ?)
			RETURNING id`, tenantID, staff.ID, period.ID, createdBy, marked).Scan(ctx, &id)
		return id, err
	}
	_, err := insertSeries(nil, false)
	require.ErrorContains(t, err, "chk_staff_shift_series_author", "a series without author and without mark")
	_, err = insertSeries(&staff.ID, true)
	require.ErrorContains(t, err, "chk_staff_shift_series_author", "a series with a staff author beside the mark")
	_, err = insertSeries(&staff.ID, false)
	require.NoError(t, err, "a series a staff member planned")
	seriesID, err := insertSeries(nil, true)
	require.NoError(t, err, "a series the Träger-Büro planned")

	insertException := func(date string, createdBy *int64, marked bool) error {
		_, err := db.ExecContext(ctx, `
			INSERT INTO schedule.staff_shift_series_exceptions (tenant_id, series_id, date, created_by, planned_by_traeger)
			VALUES (?, ?, ?, ?, ?)`, tenantID, seriesID, date, createdBy, marked)
		return err
	}
	require.ErrorContains(t, insertException("2030-09-02", nil, false), "chk_staff_shift_series_exceptions_author")
	require.ErrorContains(t, insertException("2030-09-02", &staff.ID, true), "chk_staff_shift_series_exceptions_author")
	require.NoError(t, insertException("2030-09-02", nil, true), "the occurrence of a series the Träger-Büro planned")
	require.NoError(t, insertException("2030-09-09", &staff.ID, false), "the occurrence of a staff member's series")
}

func TestTraegerStaffShiftSeriesDownRefusesWhileTraegerEntriesExist(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Lena", "Rueckbau")
	period := testpkg.CreateTestCalendarPeriod(t, db, fmt.Sprintf("Traeger-Rueckbau-%d", testpkg.UniqueSuffix()),
		testpkg.Date(2030, time.August, 1), testpkg.Date(2031, time.July, 31))
	marked := func() (count int) {
		require.NoError(t, db.NewRaw(traegerStaffShiftSeriesEntriesSQL).Scan(ctx, &count))
		return count
	}
	require.Zero(t, marked(), "the test's own database starts without entries of the Träger-Büro")

	var staffSeriesID int64
	require.NoError(t, db.NewRaw(`
		INSERT INTO schedule.staff_shift_series (tenant_id, staff_id, weekdays, start_time, end_time, calendar_period_id, valid_from, created_by)
		VALUES (?, ?, '{2}'::smallint[], '08:00', '12:00', ?, '2030-09-02', ?) RETURNING id`, tenantID, staff.ID, period.ID, staff.ID).Scan(ctx, &staffSeriesID))
	var traegerSeriesID int64
	require.NoError(t, db.NewRaw(`
		INSERT INTO schedule.staff_shift_series (tenant_id, staff_id, weekdays, start_time, end_time, calendar_period_id, valid_from, planned_by_traeger)
		VALUES (?, ?, '{1}'::smallint[], '08:00', '12:00', ?, '2030-09-02', TRUE) RETURNING id`, tenantID, staff.ID, period.ID).Scan(ctx, &traegerSeriesID))
	require.ErrorContains(t, traegerStaffShiftSeriesDown(ctx, db), "cannot be rolled back")
	require.Equal(t, 1, marked(), "the refused rollback keeps the series and its mark")

	// An exception of the Träger-Büro alone also blocks the rollback.
	_, err := db.ExecContext(ctx, `
		INSERT INTO schedule.staff_shift_series_exceptions (tenant_id, series_id, date, planned_by_traeger)
		VALUES (?, ?, '2030-09-03', TRUE)`, tenantID, staffSeriesID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM schedule.staff_shift_series WHERE id = ?`, traegerSeriesID)
	require.NoError(t, err)
	require.Equal(t, 1, marked())
	require.ErrorContains(t, traegerStaffShiftSeriesDown(ctx, db), "cannot be rolled back")

	_, err = db.ExecContext(ctx, `DELETE FROM schedule.staff_shift_series_exceptions WHERE tenant_id = ?`, tenantID)
	require.NoError(t, err)
	require.NoError(t, traegerStaffShiftSeriesDown(ctx, db))
	_, err = db.ExecContext(ctx, `
		INSERT INTO schedule.staff_shift_series_exceptions (tenant_id, series_id, date)
		VALUES (?, ?, '2030-09-10')`, tenantID, staffSeriesID)
	require.ErrorContains(t, err, "created_by", "the old shape requires the staff author again")
}
