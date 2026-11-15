package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dailyAttendanceSQL reads one row per child and day (#4717) with the same
// rule as the heatmap (arrivalPickupSlotsSQL): arrival is the first check-in,
// pickup the last check-out, counted only when no attendance of the day is
// open and the nightly cleanup did not close it at 23:59:59.
const dailyAttendanceSQL = `SELECT tenant_id, date, student_id,
  min(check_in_time) AS arrived_at,
  CASE WHEN bool_and(
    check_out_time IS NOT NULL
    AND check_out_time <> (date + time '23:59:59') AT TIME ZONE 'Europe/Berlin'
  ) THEN max(check_out_time) END AS left_at
FROM active.attendance
WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date
GROUP BY tenant_id, date, student_id
ORDER BY tenant_id, date, arrived_at, student_id`

func (c presentStudents) DailyAttendanceByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]studentpresence.ChildAttendanceDay, error) {
	db, err := c.adminDB(ctx, "daily attendance")
	if err != nil {
		return nil, err
	}
	var rows []struct {
		TenantID  int64         `bun:"tenant_id"`
		Date      calendar.Date `bun:"date"`
		StudentID int64         `bun:"student_id"`
		ArrivedAt time.Time     `bun:"arrived_at"`
		LeftAt    *time.Time    `bun:"left_at"`
	}
	if err := db.NewRaw(dailyAttendanceSQL, pgdialect.Array(schools), from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("student presence postgres: daily attendance: %w", err)
	}
	result := make([]studentpresence.ChildAttendanceDay, len(rows))
	for i, row := range rows {
		result[i] = studentpresence.ChildAttendanceDay{SchoolID: row.TenantID, Date: row.Date, StudentID: row.StudentID, ArrivedAt: row.ArrivedAt, LeftAt: row.LeftAt}
	}
	return result, nil
}
