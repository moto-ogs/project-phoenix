package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StaffShiftChange describes how a Dienstplan shift deviates from the plan
// ("Heute anders", #7661). The zero value is a plain standalone shift as
// CreateTestStaffShift writes it.
type StaffShiftChange struct {
	StartHHMM string // default "08:00"
	EndHHMM   string // default "16:00"
	Cancelled bool
	// Series links the shift to a series from CreateTestStaffShiftSeries;
	// Slot is its recurrence slot (default: the shift's day) and Detached
	// marks an edit for this week only.
	Series   *int64
	Slot     *calendar.Date
	Detached bool
	// ChangeReason is the stored why; SickAbsence the absence whose cascade
	// cancelled the shift.
	ChangeReason *string
	SickAbsence  *int64
	// Covers makes the shift a replacement for another (cancelled) shift.
	Covers *int64
}

// CreateTestStaffShiftChange inserts a shift of the staff member on the day
// through CreateTestStaffShift and stamps the deviation on it.
func CreateTestStaffShiftChange(tb testing.TB, db *bun.DB, staffID int64, day calendar.Date, change StaffShiftChange) *StaffShift {
	tb.Helper()
	row := CreateTestStaffShift(tb, db, staffID, day, StaffShiftOpts{StartHHMM: change.StartHHMM, EndHHMM: change.EndHHMM, Cancelled: change.Cancelled})
	if change.Series != nil {
		slot := day
		if change.Slot != nil {
			slot = *change.Slot
		}
		row.SeriesID, row.SeriesOccurrenceDate = change.Series, &slot
	}
	row.Detached, row.ChangeReason, row.SickAbsenceID, row.OriginShiftID = change.Detached, change.ChangeReason, change.SickAbsence, change.Covers
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := db.NewUpdate().Model(row).ModelTableExpr(`schedule.staff_shifts`).
		Column("series_id", "series_occurrence_date", "detached", "change_reason", "sick_absence_id", "origin_shift_id").
		Where("id = ?", row.ID).Exec(ctx)
	require.NoError(tb, err, "Failed to stamp the test staff shift change")
	return row
}

// CreateTestStaffShiftSeries inserts a weekly series of the staff member,
// every weekday from 08:00 to 16:00, in a calendar period around the day.
// It writes no occurrence; CreateTestStaffShiftChange links them.
func CreateTestStaffShiftSeries(tb testing.TB, db *bun.DB, staffID int64, day calendar.Date) int64 {
	tb.Helper()
	period := CreateTestCalendarPeriod(tb, db, fmt.Sprintf("Dienstplan-%d", uniqueFixtureSuffix()), day.AddDays(-14), day.AddDays(60))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var seriesID int64
	require.NoError(tb, db.NewRaw(`
		INSERT INTO schedule.staff_shift_series
			(tenant_id, staff_id, weekdays, start_time, end_time, calendar_period_id, valid_from, created_by)
		VALUES (?, ?, ARRAY[1,2,3,4,5,6,7]::smallint[], '08:00', '16:00', ?, ?, ?)
		RETURNING id`,
		fixtureTenantID(tb), staffID, period.ID, day.AddDays(-14).String(), staffID,
	).Scan(ctx, &seriesID), "Failed to create test staff shift series")
	return seriesID
}
