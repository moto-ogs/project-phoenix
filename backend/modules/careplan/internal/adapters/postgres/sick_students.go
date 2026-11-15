package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

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

// statusDayCountsSQL counts the status days that stand for the day, as the
// sick days above, one per child, day and status, on Monday to Friday of the
// window. It takes the school set and the window (from, to).
const statusDayCountsSQL = `SELECT tenant_id, status, COUNT(DISTINCT (student_id, date))::int AS days FROM active.student_status_days
WHERE tenant_id = ANY(?0) AND date BETWEEN ?1::date AND ?2::date AND status IN ('sick', 'excused')
  AND date_part('isodow', date) < 6
  AND (cleared_at IS NULL OR (source = '` + statusSourceEndDay + `' AND cleared_source IS NULL))
GROUP BY tenant_id, status`

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

func (s sickStudents) StatusDayCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]int, map[int64]int, error) {
	sick, excused := map[int64]int{}, map[int64]int{}
	if len(schools) == 0 {
		return sick, excused, nil
	}
	db, err := s.database(ctx)
	if err != nil {
		return nil, nil, err
	}
	var rows []struct {
		TenantID int64  `bun:"tenant_id"`
		Status   string `bun:"status"`
		Days     int    `bun:"days"`
	}
	if err := db.NewRaw(statusDayCountsSQL, pgdialect.Array(schools), from, to).Scan(ctx, &rows); err != nil {
		return nil, nil, fmt.Errorf("care plan postgres: status day counts: %w", err)
	}
	for _, row := range rows {
		if row.Status == "sick" {
			sick[row.TenantID] = row.Days
		} else {
			excused[row.TenantID] = row.Days
		}
	}
	return sick, excused, nil
}
