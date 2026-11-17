package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewPresenceSeries reads on the caller's administrative transaction; now
// ends open visits and dates the visit retention, the clock that stamps the
// visits (ADR 0281).
func NewPresenceSeries(transaction func(context.Context) (any, bool), admin func(context.Context) bool, now func() time.Time) studentpresence.PresenceSeries {
	if now == nil {
		panic("student presence postgres: the presence series needs the composition's clock")
	}
	return presenceSeries{transaction: transaction, admin: admin, now: now}
}

type presenceSeries struct {
	transaction func(context.Context) (any, bool)
	admin       func(context.Context) bool
	now         func() time.Time
}

func (s presenceSeries) database(ctx context.Context) (bun.IDB, error) {
	transaction, ok := s.transaction(ctx)
	if !ok {
		return nil, errors.New("student presence: transaction is required")
	}
	if !s.admin(ctx) {
		return nil, errors.New("student presence: presence series need the administrative transaction")
	}
	switch tx := transaction.(type) {
	case bun.Tx:
		return tx, nil
	case *bun.Tx:
		if tx != nil {
			return *tx, nil
		}
	}
	return nil, fmt.Errorf("student presence postgres: unsupported transaction %T", transaction)
}

// attendanceCountsSQL takes the school set and the window (from, to). It
// lists every school with an attendance up to to, its first such day and,
// per day of the window, the children with an attendance.
const attendanceCountsSQL = `WITH firsts AS (
  SELECT tenant_id, MIN(date) AS first_day FROM active.attendance
  WHERE tenant_id = ANY(?0) AND date <= ?2::date GROUP BY tenant_id
),
counts AS (
  SELECT tenant_id, date, COUNT(DISTINCT student_id)::int AS children FROM active.attendance
  WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date GROUP BY tenant_id, date
)
SELECT firsts.tenant_id, firsts.first_day, counts.date, COALESCE(counts.children, 0) AS children
FROM firsts LEFT JOIN counts ON counts.tenant_id = firsts.tenant_id
ORDER BY firsts.tenant_id, counts.date`

func (s presenceSeries) AttendanceCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]studentpresence.SchoolAttendanceCounts, error) {
	result := make(map[int64]studentpresence.SchoolAttendanceCounts, len(schools))
	if len(schools) == 0 {
		return result, nil
	}
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		TenantID int64          `bun:"tenant_id"`
		FirstDay calendar.Date  `bun:"first_day"`
		Date     *calendar.Date `bun:"date"`
		Children int            `bun:"children"`
	}
	if err := db.NewRaw(attendanceCountsSQL, pgdialect.Array(schools), from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("student presence postgres: attendance counts: %w", err)
	}
	for _, row := range rows {
		school, ok := result[row.TenantID]
		if !ok {
			first := row.FirstDay
			school = studentpresence.SchoolAttendanceCounts{FirstDay: &first, Children: map[calendar.Date]int{}}
		}
		if row.Date != nil {
			school.Children[*row.Date] = row.Children
		}
		result[row.TenantID] = school
	}
	return result, nil
}

// roomDaysSQL takes the school set, the window (from, to) and the owner's
// instant (now). It counts the
// visits the Statistik report counts (roomUtilizationQuery): only children
// with an accepted privacy consent, only visits within its retention. A visit
// belongs to the Berlin day it began on and ends at that day's end at the
// latest; an open visit ends now. The peak sweeps the entries and exits of a
// room and day, an exit before an entry at the same instant.
const roomDaysSQL = `WITH retention AS (
  SELECT tenant_id, student_id, MIN(data_retention_days) AS retention_days
  FROM users.privacy_consents
  WHERE accepted = TRUE AND tenant_id = ANY(?0)
  GROUP BY tenant_id, student_id
),
counted AS (
  SELECT v.tenant_id, ag.room_id, v.student_id, v.entry_time,
    COALESCE(v.exit_time, ?3::timestamptz) AS exit_time,
    (v.entry_time AT TIME ZONE 'Europe/Berlin')::date AS day
  FROM active.visits AS v
  JOIN active.groups AS ag ON ag.id = v.active_group_id AND ag.tenant_id = v.tenant_id
  JOIN retention AS r ON r.tenant_id = v.tenant_id AND r.student_id = v.student_id
  WHERE v.tenant_id = ANY(?0) AND ag.room_id IS NOT NULL
    AND v.created_at >= ?3::timestamptz - make_interval(days => r.retention_days)
    AND v.entry_time < ((?2::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
),
firsts AS (
  SELECT tenant_id, MIN(day) AS first_day FROM counted GROUP BY tenant_id
),
scoped AS (
  SELECT tenant_id, room_id, student_id, day, entry_time AS entry_at,
    LEAST(exit_time, ((day + 1)::timestamp AT TIME ZONE 'Europe/Berlin')) AS exit_at
  FROM counted
  WHERE day >= ?1::date
),
visits AS (
  SELECT * FROM scoped WHERE exit_at > entry_at
),
events AS (
  SELECT tenant_id, room_id, day, entry_at AS at, 1 AS delta FROM visits
  UNION ALL
  SELECT tenant_id, room_id, day, exit_at AS at, -1 AS delta FROM visits
),
running AS (
  SELECT tenant_id, room_id, day,
    SUM(delta) OVER (PARTITION BY tenant_id, room_id, day ORDER BY at, delta) AS occupancy
  FROM events
),
peaks AS (
  SELECT tenant_id, room_id, day, MAX(occupancy)::int AS peak FROM running GROUP BY tenant_id, room_id, day
),
children AS (
  SELECT tenant_id, room_id, day, COUNT(DISTINCT student_id)::int AS children FROM visits GROUP BY tenant_id, room_id, day
)
SELECT firsts.tenant_id, firsts.first_day, children.room_id, children.day, COALESCE(children.children, 0) AS children, COALESCE(peaks.peak, 0) AS peak
FROM firsts
LEFT JOIN children ON children.tenant_id = firsts.tenant_id
LEFT JOIN peaks ON peaks.tenant_id = children.tenant_id AND peaks.room_id = children.room_id AND peaks.day = children.day
ORDER BY firsts.tenant_id, children.day, children.room_id`

func (s presenceSeries) RoomDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]studentpresence.SchoolRoomDays, error) {
	result := make(map[int64]studentpresence.SchoolRoomDays, len(schools))
	if len(schools) == 0 {
		return result, nil
	}
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		TenantID int64          `bun:"tenant_id"`
		FirstDay calendar.Date  `bun:"first_day"`
		RoomID   *int64         `bun:"room_id"`
		Day      *calendar.Date `bun:"day"`
		Children int            `bun:"children"`
		Peak     int            `bun:"peak"`
	}
	if err := db.NewRaw(roomDaysSQL, pgdialect.Array(schools), from, to, s.now()).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("student presence postgres: room days: %w", err)
	}
	for _, row := range rows {
		school, ok := result[row.TenantID]
		if !ok {
			first := row.FirstDay
			school = studentpresence.SchoolRoomDays{FirstDay: &first}
		}
		if row.RoomID != nil && row.Day != nil {
			school.Days = append(school.Days, studentpresence.RoomDay{RoomID: *row.RoomID, Day: *row.Day, Children: row.Children, Peak: row.Peak})
		}
		result[row.TenantID] = school
	}
	return result, nil
}
