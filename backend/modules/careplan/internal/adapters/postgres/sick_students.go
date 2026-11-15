package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// NewSickStudents reads on the caller's administrative transaction.
func NewSickStudents(transaction func(context.Context) (any, bool), admin func(context.Context) bool) *sickStudents {
	return &sickStudents{transaction: transaction, admin: admin}
}

type sickStudents struct {
	transaction func(context.Context) (any, bool)
	admin       func(context.Context) bool
}

// sickDayStudentIDsSQL reads the sick days that stand for the day: active or
// archived at its end, as the dashboard and the day log read them (#6291).
const sickDayStudentIDsSQL = `SELECT DISTINCT tenant_id, student_id AS id FROM active.student_status_days
WHERE tenant_id = ANY(?) AND date = ?::date AND status = 'sick' AND (cleared_at IS NULL OR (source = '` + statusSourceEndDay + `' AND cleared_source IS NULL))`

// statusDayCountsSQL counts, per school and day, the children with a status
// day that stands for the day, as the sick days above, on Monday to Friday of
// the window. A child counts once a day; sick wins over excused. It takes the
// school set and the window (from, to).
const statusDayCountsSQL = `SELECT tenant_id, date,
  COUNT(*) FILTER (WHERE sick)::int AS sick, COUNT(*) FILTER (WHERE NOT sick)::int AS excused
FROM (
  SELECT tenant_id, student_id, date, bool_or(status = 'sick') AS sick FROM active.student_status_days
  WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date AND status IN ('sick', 'excused')
    AND date_part('isodow', date) < 6
    AND (cleared_at IS NULL OR (source = '` + statusSourceEndDay + `' AND cleared_source IS NULL))
  GROUP BY tenant_id, student_id, date
) AS child_days
GROUP BY tenant_id, date`

// statusDaysSQL reads the status days that stand for their day, as the sick
// days above, between from and to: one row per child and day, sick before
// excused before class trip (#4717).
const statusDaysSQL = `SELECT DISTINCT ON (tenant_id, date, student_id) tenant_id, date, student_id, status
FROM active.student_status_days
WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date
  AND (cleared_at IS NULL OR (source = '` + statusSourceEndDay + `' AND cleared_source IS NULL))
ORDER BY tenant_id, date, student_id,
  CASE status WHEN 'sick' THEN 0 WHEN 'excused' THEN 1 ELSE 2 END`

const sickFlagMembershipIDsSQL = `SELECT tenant_id, membership_id AS id FROM users.student_care_profiles
WHERE tenant_id = ANY(?) AND sick`

type sickStudentRow struct {
	TenantID int64 `bun:"tenant_id"`
	ID       int64 `bun:"id"`
}

func (s sickStudents) database(ctx context.Context) (bun.IDB, error) {
	transaction, ok := s.transaction(ctx)
	if !ok {
		return nil, errors.New("care plan: transaction is required")
	}
	if !s.admin(ctx) {
		return nil, errors.New("care plan: sick students need the administrative transaction")
	}
	switch tx := transaction.(type) {
	case bun.Tx:
		return tx, nil
	case *bun.Tx:
		if tx != nil {
			return *tx, nil
		}
	}
	return nil, fmt.Errorf("care plan postgres: unsupported transaction %T", transaction)
}

func idsByTenant(rows []sickStudentRow) map[int64][]int64 {
	result := map[int64][]int64{}
	for _, row := range rows {
		result[row.TenantID] = append(result[row.TenantID], row.ID)
	}
	return result
}

func (s sickStudents) SickDayStudentIDsByTenant(ctx context.Context, schools []int64, at time.Time) (map[int64][]int64, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []sickStudentRow
	if err := db.NewRaw(sickDayStudentIDsSQL, pgdialect.Array(schools), calendar.DateFromTime(at)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care plan postgres: sick days: %w", err)
	}
	return idsByTenant(rows), nil
}

func (s sickStudents) SickFlagMembershipIDsByTenant(ctx context.Context, schools []int64) (map[int64][]int64, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []sickStudentRow
	if err := db.NewRaw(sickFlagMembershipIDsSQL, pgdialect.Array(schools)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care plan postgres: sick flags: %w", err)
	}
	return idsByTenant(rows), nil
}

func (s sickStudents) StatusDayCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]map[calendar.Date]int, map[int64]map[calendar.Date]int, error) {
	sick, excused := map[int64]map[calendar.Date]int{}, map[int64]map[calendar.Date]int{}
	if len(schools) == 0 {
		return sick, excused, nil
	}
	db, err := s.database(ctx)
	if err != nil {
		return nil, nil, err
	}
	var rows []struct {
		TenantID int64         `bun:"tenant_id"`
		Date     calendar.Date `bun:"date"`
		Sick     int           `bun:"sick"`
		Excused  int           `bun:"excused"`
	}
	if err := db.NewRaw(statusDayCountsSQL, pgdialect.Array(schools), from, to).Scan(ctx, &rows); err != nil {
		return nil, nil, fmt.Errorf("care plan postgres: status day counts: %w", err)
	}
	add := func(counts map[int64]map[calendar.Date]int, tenantID int64, day calendar.Date, children int) {
		if children == 0 {
			return
		}
		if counts[tenantID] == nil {
			counts[tenantID] = map[calendar.Date]int{}
		}
		counts[tenantID][day] = children
	}
	for _, row := range rows {
		add(sick, row.TenantID, row.Date, row.Sick)
		add(excused, row.TenantID, row.Date, row.Excused)
	}
	return sick, excused, nil
}

func (s sickStudents) StatusDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]careplan.StatusDay, error) {
	db, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		TenantID  int64         `bun:"tenant_id"`
		Date      calendar.Date `bun:"date"`
		StudentID int64         `bun:"student_id"`
		Status    string        `bun:"status"`
	}
	if err := db.NewRaw(statusDaysSQL, pgdialect.Array(schools), from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care plan postgres: status days: %w", err)
	}
	result := make([]careplan.StatusDay, len(rows))
	for i, row := range rows {
		result[i] = careplan.StatusDay{SchoolID: row.TenantID, Date: row.Date, StudentID: row.StudentID, Status: row.Status}
	}
	return result, nil
}
