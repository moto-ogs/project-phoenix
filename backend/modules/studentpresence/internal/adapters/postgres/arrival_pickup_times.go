package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// arrivalPickupSlotsSQL counts the arrivals and pickups of the Träger's
// heatmap (#4714) per school, ISO weekday and half hour of the Berlin wall
// clock. Each child counts once a day: it arrives with its first check-in and
// is picked up with its last check-out, which counts only when no attendance
// of the day is still open.
const arrivalPickupSlotsSQL = `WITH child_days AS (
  SELECT tenant_id, date,
    min(check_in_time) AS arrived_at,
    CASE WHEN bool_and(check_out_time IS NOT NULL) THEN max(check_out_time) END AS picked_up_at
  FROM active.attendance
  WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date
  GROUP BY tenant_id, student_id, date
), marks AS (
  SELECT tenant_id, date, arrived_at AT TIME ZONE 'Europe/Berlin' AS wall, 1 AS arrival
  FROM child_days
  UNION ALL
  SELECT tenant_id, date, picked_up_at AT TIME ZONE 'Europe/Berlin', 0
  FROM child_days WHERE picked_up_at IS NOT NULL
)
SELECT tenant_id,
  date_part('isodow', date)::int AS weekday,
  ((date_part('hour', wall)::int * 60 + date_part('minute', wall)::int) / ?3) * ?3 AS start_minute,
  count(*) FILTER (WHERE arrival = 1) AS arrivals,
  count(*) FILTER (WHERE arrival = 0) AS pickups
FROM marks
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3`

// attendanceWeekdaysSQL counts the days of each weekday a school recorded an
// attendance on, the divisor of the heatmap's averages.
const attendanceWeekdaysSQL = `SELECT tenant_id,
  date_part('isodow', date)::int AS weekday,
  count(DISTINCT date) AS days,
  min(date) AS first_day
FROM active.attendance
WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date
GROUP BY 1, 2
ORDER BY 1, 2`

func (c presentStudents) ArrivalPickupTimesByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]studentpresence.ArrivalPickupSlot, []studentpresence.AttendanceWeekday, error) {
	db, err := c.adminDB(ctx, "arrival and pickup times")
	if err != nil {
		return nil, nil, err
	}
	var slots []struct {
		TenantID    int64 `bun:"tenant_id"`
		Weekday     int   `bun:"weekday"`
		StartMinute int   `bun:"start_minute"`
		Arrivals    int   `bun:"arrivals"`
		Pickups     int   `bun:"pickups"`
	}
	if err := db.NewRaw(arrivalPickupSlotsSQL, pgdialect.Array(schools), from, to, studentpresence.OccupancySlotMinutes).Scan(ctx, &slots); err != nil {
		return nil, nil, fmt.Errorf("student presence postgres: arrival and pickup slots: %w", err)
	}
	var days []struct {
		TenantID int64         `bun:"tenant_id"`
		Weekday  int           `bun:"weekday"`
		Days     int           `bun:"days"`
		FirstDay calendar.Date `bun:"first_day"`
	}
	if err := db.NewRaw(attendanceWeekdaysSQL, pgdialect.Array(schools), from, to).Scan(ctx, &days); err != nil {
		return nil, nil, fmt.Errorf("student presence postgres: attendance weekdays: %w", err)
	}
	result := make([]studentpresence.ArrivalPickupSlot, len(slots))
	for i, slot := range slots {
		result[i] = studentpresence.ArrivalPickupSlot{SchoolID: slot.TenantID, Weekday: slot.Weekday, StartMinute: slot.StartMinute, Arrivals: slot.Arrivals, Pickups: slot.Pickups}
	}
	weekdays := make([]studentpresence.AttendanceWeekday, len(days))
	for i, day := range days {
		weekdays[i] = studentpresence.AttendanceWeekday{SchoolID: day.TenantID, Weekday: day.Weekday, Days: day.Days, FirstDay: day.FirstDay}
	}
	return result, weekdays, nil
}
