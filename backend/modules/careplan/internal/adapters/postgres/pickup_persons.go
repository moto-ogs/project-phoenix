package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

// The pickup person of one day (#7655), schedule.student_pickup_persons.

type pickupPersonRow struct {
	bun.BaseModel     `bun:"table:schedule.student_pickup_persons,alias:student_pickup_person"`
	ID                int64         `bun:"id,pk,autoincrement"`
	TenantID          int64         `bun:"tenant_id,notnull"`
	CreatedAt         time.Time     `bun:"created_at,nullzero,notnull"`
	UpdatedAt         time.Time     `bun:"updated_at,nullzero,notnull"`
	StudentID         int64         `bun:"student_id,notnull"`
	ExceptionDate     calendar.Date `bun:"exception_date,notnull,type:date"`
	PersonName        string        `bun:"person_name,notnull"`
	GuardianProfileID *int64        `bun:"guardian_profile_id"`
	CreatedBy         *int64        `bun:"created_by"`
}

// dayPickupRow is one child of the day with its Abholart, its pickup person,
// or both. The departure and person columns are NULL where the child has no
// value of that kind.
type dayPickupRow struct {
	StudentID           int64      `bun:"student_id"`
	DepartureID         *int64     `bun:"departure_id"`
	DepartureCreatedAt  *time.Time `bun:"departure_created_at"`
	DepartureUpdatedAt  *time.Time `bun:"departure_updated_at"`
	DepartureMode       *string    `bun:"departure_mode"`
	DepartureReason     *string    `bun:"departure_reason"`
	DepartureCreatedBy  *int64     `bun:"departure_created_by"`
	DepartureByTraeger  *bool      `bun:"departure_entered_by_traeger"`
	PersonID            *int64     `bun:"person_id"`
	PersonCreatedAt     *time.Time `bun:"person_created_at"`
	PersonUpdatedAt     *time.Time `bun:"person_updated_at"`
	PersonName          *string    `bun:"person_name"`
	PersonGuardianID    *int64     `bun:"person_guardian_profile_id"`
	PersonCreatedBy     *int64     `bun:"person_created_by"`
	ExceptionDateString string     `bun:"exception_date"`
}

// ListDayPickups reads the Abholart and pickup person of every child and
// day in one statement. Day views read both for many children, and a second
// statement would grow their query budgets. A zero to has no end.
func (s *Store) ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]careplan.DayPickup, domain.OperationStats, error) {
	db, tid, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	if studentIDs != nil && len(studentIDs) == 0 {
		return []careplan.DayPickup{}, domain.OperationStats{}, nil
	}
	filter, args := `tenant_id = ? AND exception_date >= ?`, []any{tid, from}
	if !to.IsZero() {
		filter, args = filter+` AND exception_date <= ?`, append(args, to)
	}
	if studentIDs != nil {
		filter, args = filter+` AND student_id IN (?)`, append(args, bun.List(studentIDs))
	}
	rows := []dayPickupRow{}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(`
		SELECT COALESCE(d.student_id, p.student_id) AS student_id,
			COALESCE(d.exception_date, p.exception_date)::text AS exception_date,
			d.id AS departure_id, d.created_at AS departure_created_at, d.updated_at AS departure_updated_at,
			d.departure_mode, d.reason AS departure_reason, d.created_by AS departure_created_by,
			d.entered_by_traeger AS departure_entered_by_traeger,
			p.id AS person_id, p.created_at AS person_created_at, p.updated_at AS person_updated_at,
			p.person_name, p.guardian_profile_id AS person_guardian_profile_id, p.created_by AS person_created_by
		FROM (SELECT * FROM schedule.student_departure_exceptions WHERE `+filter+`) AS d
		FULL JOIN (SELECT * FROM schedule.student_pickup_persons WHERE `+filter+`) AS p
			ON p.student_id = d.student_id AND p.exception_date = d.exception_date
		ORDER BY 2, 1`, append(args, args...)...).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("care plan postgres: list day pickups: %w", err)
	}
	stats.Rows = int64(len(rows))
	return mapRows(rows, func(row dayPickupRow) careplan.DayPickup { return row.toPublic(tid) }), stats, nil
}

func (row dayPickupRow) toPublic(tenantID int64) careplan.DayPickup {
	day := careplan.Date(row.ExceptionDateString)
	out := careplan.DayPickup{StudentID: row.StudentID, Date: day}
	if row.DepartureID != nil && row.DepartureMode != nil {
		departure := careplan.DepartureException{
			ID: *row.DepartureID, TenantID: tenantID, StudentID: row.StudentID, ExceptionDate: day,
			DepartureMode: *row.DepartureMode, Reason: row.DepartureReason, CreatedBy: row.DepartureCreatedBy,
			EnteredByTraeger: row.DepartureByTraeger != nil && *row.DepartureByTraeger,
		}
		departure.CreatedAt, departure.UpdatedAt = instant(row.DepartureCreatedAt), instant(row.DepartureUpdatedAt)
		out.Departure = &departure
	}
	if row.PersonID != nil && row.PersonName != nil {
		person := careplan.PickupPerson{
			ID: *row.PersonID, TenantID: tenantID, StudentID: row.StudentID, ExceptionDate: day,
			Name: *row.PersonName, GuardianProfileID: row.PersonGuardianID, CreatedBy: row.PersonCreatedBy,
		}
		person.CreatedAt, person.UpdatedAt = instant(row.PersonCreatedAt), instant(row.PersonUpdatedAt)
		out.Person = &person
	}
	return out
}

func instant(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

// SavePickupPerson writes the one pickup person of the child's day. The
// caller holds the care-day lock, so the upsert never races another writer
// of the same day.
func (s *Store) SavePickupPerson(ctx context.Context, v careplan.PickupPerson) (careplan.PickupPerson, domain.OperationStats, error) {
	db, tid, err := s.databaseForWrite(ctx, "save pickup person")
	if err != nil {
		return careplan.PickupPerson{}, domain.OperationStats{}, err
	}
	row := pickupPersonRow{
		TenantID: tid, StudentID: v.StudentID, ExceptionDate: calendar.Date(v.ExceptionDate),
		PersonName: v.Name, GuardianProfileID: v.GuardianProfileID, CreatedBy: v.CreatedBy,
	}
	query := db.NewInsert().Model(&row).ModelTableExpr(`schedule.student_pickup_persons`).
		On(`CONFLICT (tenant_id, student_id, exception_date) DO UPDATE`).
		Set(`person_name = EXCLUDED.person_name`).
		Set(`guardian_profile_id = EXCLUDED.guardian_profile_id`).
		Set(`created_by = EXCLUDED.created_by`)
	stats, err := createStudentScheduleRow(ctx, query, "save pickup person")
	return pickupPersonToPublic(row), stats, err
}

// DeletePickupPerson removes the pickup person of the child's day and
// reports whether there was one.
func (s *Store) DeletePickupPerson(ctx context.Context, studentID int64, date calendar.Date) (bool, domain.OperationStats, error) {
	db, tid, err := s.databaseForWrite(ctx, "delete pickup person")
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	stats, affected, err := execute(ctx, db.NewDelete().TableExpr(`schedule.student_pickup_persons AS "student_pickup_person"`).
		Where(`"student_pickup_person".tenant_id = ?`, tid).
		Where(`"student_pickup_person".student_id = ?`, studentID).
		Where(`"student_pickup_person".exception_date = ?`, calendarDate(date)), "delete pickup person")
	return affected > 0, stats, err
}

// DeletePastPickupPersons deletes every pickup person of a day before the
// store's Berlin day (#7655, nightly retention).
func (s *Store) DeletePastPickupPersons(ctx context.Context) (int, error) {
	db, tid, err := s.databaseForWrite(ctx, "delete past pickup persons")
	if err != nil {
		return 0, err
	}
	today := calendar.DateFromTime(s.currentTime())
	_, affected, err := execute(ctx, db.NewDelete().TableExpr(`schedule.student_pickup_persons AS "student_pickup_person"`).
		Where(`"student_pickup_person".tenant_id = ?`, tid).
		Where(`"student_pickup_person".exception_date < ?`, calendarDate(today)), "delete past pickup persons")
	return int(affected), err
}

func pickupPersonToPublic(v pickupPersonRow) careplan.PickupPerson {
	return careplan.PickupPerson{
		ID: v.ID, TenantID: v.TenantID, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt, StudentID: v.StudentID,
		ExceptionDate: careplan.Date(v.ExceptionDate), Name: v.PersonName, GuardianProfileID: v.GuardianProfileID, CreatedBy: v.CreatedBy,
	}
}
