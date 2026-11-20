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
// ("Heute anders", #7661). The zero value is a plain standalone shift.
type StaffShiftChange struct {
	StartHHMM string // default "08:00"
	EndHHMM   string // default "16:00"
	// FromSeries materializes the shift from a weekly series of the staff
	// member; Detached marks it as edited for this week only.
	FromSeries bool
	Detached   bool
	Cancelled  bool
	// ChangeReason is the stored why; the plan cascade writes "Krankheit"
	// or "Abwesenheit" for an absence.
	ChangeReason *string
	// Covers makes the shift a replacement for another (cancelled) shift.
	Covers *int64
}

// CreateTestStaffShiftChange inserts a shift of the staff member on the day
// with the given deviation, and its series when FromSeries is set. The
// tenant-owned rows die with the clone.
func CreateTestStaffShiftChange(tb testing.TB, db *bun.DB, staffID int64, day calendar.Date, change StaffShiftChange) *StaffShift {
	tb.Helper()
	start, end := change.StartHHMM, change.EndHHMM
	if start == "" {
		start = "08:00"
	}
	if end == "" {
		end = "16:00"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tenantID := fixtureTenantID(tb)
	row := &StaffShift{
		StaffID: staffID, Date: day,
		StartTime: parseTimeHHMM(tb, start), EndTime: parseTimeHHMM(tb, end),
		Cancelled: change.Cancelled, ChangeReason: change.ChangeReason,
		OriginShiftID: change.Covers, Detached: change.Detached, CreatedBy: staffID,
	}
	row.TenantID = tenantID
	if change.FromSeries {
		period := CreateTestCalendarPeriod(tb, db, fmt.Sprintf("Dienstplan-%d", uniqueFixtureSuffix()), day.AddDays(-7), day.AddDays(60))
		var seriesID int64
		require.NoError(tb, db.NewRaw(`
			INSERT INTO schedule.staff_shift_series
				(tenant_id, staff_id, weekdays, start_time, end_time, calendar_period_id, valid_from, created_by)
			VALUES (?, ?, ARRAY[?]::smallint[], '08:00', '16:00', ?, ?, ?)
			RETURNING id`,
			tenantID, staffID, int(day.Weekday()+6)%7+1, period.ID, day.AddDays(-7).String(), staffID,
		).Scan(ctx, &seriesID), "Failed to create test staff shift series")
		occurrence := day
		row.SeriesID, row.SeriesOccurrenceDate = &seriesID, &occurrence
	}
	_, err := db.NewInsert().Model(row).ModelTableExpr(`schedule.staff_shifts`).Exec(ctx)
	require.NoError(tb, err, "Failed to create test staff shift")
	return row
}
