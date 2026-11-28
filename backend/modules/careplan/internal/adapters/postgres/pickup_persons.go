package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
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
	RequestedBy       *int64        `bun:"requested_by_guardian"`
	// RelationshipID is set by the database from student and contact
	// (#8206); a write leaves it to the trigger.
	RelationshipID *int64 `bun:"relationship_id"`
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
	PersonRequestedBy   *int64     `bun:"person_requested_by_guardian"`
	PersonWithdrawn     bool       `bun:"person_permission_withdrawn"`
	ExceptionDateString string     `bun:"exception_date"`
}

// ListDayPickups reads the Abholart and pickup person of every child and
// day in one statement. Day views read both for many children, and a second
// statement would grow their query budgets. A zero to has no end. The
// statement also reads the pickup permission a staff-set contact rests on,
// through the relationship the database links to every contact's day, and
// marks the day when it no longer holds (#8206). A weekend counts as Friday
// only where the tenant's weekend follows Friday's plan.
func (s *Store) ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]careplan.DayPickup, domain.OperationStats, error) {
	db, tid, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	if studentIDs != nil && len(studentIDs) == 0 {
		return []careplan.DayPickup{}, domain.OperationStats{}, nil
	}
	weekendFollowsFriday, err := weekendPlanForPickupRange(ctx, from, to)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	// A NULL end or child list reads without that limit.
	var until, students any
	if !to.IsZero() {
		until = to
	}
	if studentIDs != nil {
		students = pgdialect.Array(studentIDs)
	}
	rows := []dayPickupRow{}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(`
		WITH d AS (
			SELECT * FROM schedule.student_departure_exceptions
			WHERE tenant_id = ?0 AND exception_date >= ?1 AND (?2::date IS NULL OR exception_date <= ?2::date)
				AND (?3::bigint[] IS NULL OR student_id = ANY(?3::bigint[]))
		), p AS (
			SELECT person.*, (person.guardian_profile_id IS NOT NULL AND person.requested_by_guardian IS NULL
				AND NOT COALESCE(permission.can_pickup AND (permission.pickup_weekdays IS NULL
					OR CASE WHEN ?4::bool THEN LEAST(date_part('isodow', person.exception_date)::int, 5)
						ELSE date_part('isodow', person.exception_date)::int END = ANY(permission.pickup_weekdays))
					AND (date_part('isodow', person.exception_date)::int <= 5 OR ?4::bool), false)) AS permission_withdrawn
			FROM schedule.student_pickup_persons AS person
			LEFT JOIN users.student_guardian_pickup_permissions AS permission
				ON permission.tenant_id = person.tenant_id AND permission.relationship_id = person.relationship_id
			WHERE person.tenant_id = ?0 AND person.exception_date >= ?1 AND (?2::date IS NULL OR person.exception_date <= ?2::date)
				AND (?3::bigint[] IS NULL OR person.student_id = ANY(?3::bigint[]))
		)
		SELECT COALESCE(d.student_id, p.student_id) AS student_id,
			COALESCE(d.exception_date, p.exception_date)::text AS exception_date,
			d.id AS departure_id, d.created_at AS departure_created_at, d.updated_at AS departure_updated_at,
			d.departure_mode, d.reason AS departure_reason, d.created_by AS departure_created_by,
			d.entered_by_traeger AS departure_entered_by_traeger,
			p.id AS person_id, p.created_at AS person_created_at, p.updated_at AS person_updated_at,
			p.person_name, p.guardian_profile_id AS person_guardian_profile_id, p.created_by AS person_created_by,
			p.requested_by_guardian AS person_requested_by_guardian,
			COALESCE(p.permission_withdrawn, false) AS person_permission_withdrawn
		FROM d FULL JOIN p ON p.student_id = d.student_id AND p.exception_date = d.exception_date
		ORDER BY 2, 1`, tid, from, until, students, weekendFollowsFriday).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("care plan postgres: list day pickups: %w", err)
	}
	stats.Rows = int64(len(rows))
	return mapRows(rows, func(row dayPickupRow) careplan.DayPickup { return row.toPublic(tid) }), stats, nil
}

func weekendPlanForPickupRange(ctx context.Context, from, to calendar.Date) (bool, error) {
	if !rangeIncludesWeekend(from, to) {
		return false, nil
	}
	followsFriday, err := calendar.WeekendFollowsFriday(ctx)
	if err != nil {
		return false, fmt.Errorf("care plan postgres: resolve weekend plan: %w", err)
	}
	return followsFriday, nil
}

// rangeIncludesWeekend avoids resolving the tenant setting for weekday-only
// reads. Every seven-day span contains a weekend; checking the shorter range
// directly keeps ListDayPickups one statement for its ordinary weekday paths.
func rangeIncludesWeekend(from, to calendar.Date) bool {
	if to.IsZero() || !to.Before(from.AddDays(6)) {
		return true
	}
	for day := from; !to.Before(day); day = day.AddDays(1) {
		if calendar.IsWeekend(day) {
			return true
		}
	}
	return false
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
			RequestedByGuardian: row.PersonRequestedBy, PermissionWithdrawn: row.PersonWithdrawn,
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

// LockGuardianPickupPermission locks one relationship's pickup permission
// and returns whether it currently applies on the plan weekday. Permission
// writes update this same row, so a withdrawal cannot pass between this check
// and saving the day's pickup person.
func (s *Store) LockGuardianPickupPermission(ctx context.Context, relationshipID int64, weekday int) (bool, domain.OperationStats, error) {
	db, tenantID, err := s.databaseForWrite(ctx, "lock guardian pickup permission")
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	var allowed bool
	err = db.NewRaw(`SELECT can_pickup AND (pickup_weekdays IS NULL OR ? = ANY(pickup_weekdays))
		FROM users.student_guardian_pickup_permissions
		WHERE tenant_id = ? AND relationship_id = ?
		FOR UPDATE`, weekday, tenantID, relationshipID).Scan(ctx, &allowed)
	stats.StatementDuration = time.Since(started)
	if errors.Is(err, sql.ErrNoRows) {
		return false, stats, nil
	}
	if err != nil {
		return false, stats, fmt.Errorf("care plan postgres: lock guardian pickup permission: %w", err)
	}
	return allowed, stats, nil
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
		RequestedBy: v.RequestedByGuardian,
	}
	query := db.NewInsert().Model(&row).ModelTableExpr(`schedule.student_pickup_persons`).
		On(`CONFLICT (tenant_id, student_id, exception_date) DO UPDATE`).
		Set(`person_name = EXCLUDED.person_name`).
		Set(`guardian_profile_id = EXCLUDED.guardian_profile_id`).
		Set(`created_by = EXCLUDED.created_by`).
		Set(`requested_by_guardian = EXCLUDED.requested_by_guardian`)
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

// DeletePickupPersonByID removes one pickup person row of the child and
// reports whether it was there.
func (s *Store) DeletePickupPersonByID(ctx context.Context, studentID, id int64) (bool, domain.OperationStats, error) {
	db, tid, err := s.databaseForWrite(ctx, "delete pickup person by id")
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	stats, affected, err := execute(ctx, db.NewDelete().TableExpr(`schedule.student_pickup_persons AS "student_pickup_person"`).
		Where(`"student_pickup_person".tenant_id = ?`, tid).
		Where(`"student_pickup_person".student_id = ?`, studentID).
		Where(`"student_pickup_person".id = ?`, id), "delete pickup person by id")
	return affected > 0, stats, err
}

// DeletePastPickupPersons deletes every pickup person of a day before the
// store's Berlin day less window (#7655, nightly retention).
func (s *Store) DeletePastPickupPersons(ctx context.Context, window time.Duration) (int, error) {
	db, tid, err := s.databaseForWrite(ctx, "delete past pickup persons")
	if err != nil {
		return 0, err
	}
	today := calendar.DateFromTime(s.currentTime().Add(-window))
	_, affected, err := execute(ctx, db.NewDelete().TableExpr(`schedule.student_pickup_persons AS "student_pickup_person"`).
		Where(`"student_pickup_person".tenant_id = ?`, tid).
		Where(`"student_pickup_person".exception_date < ?`, calendarDate(today)), "delete past pickup persons")
	return int(affected), err
}

func pickupPersonToPublic(v pickupPersonRow) careplan.PickupPerson {
	return careplan.PickupPerson{
		ID: v.ID, TenantID: v.TenantID, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt, StudentID: v.StudentID,
		ExceptionDate: careplan.Date(v.ExceptionDate), Name: v.PersonName, GuardianProfileID: v.GuardianProfileID, CreatedBy: v.CreatedBy,
		RequestedByGuardian: v.RequestedBy,
	}
}
