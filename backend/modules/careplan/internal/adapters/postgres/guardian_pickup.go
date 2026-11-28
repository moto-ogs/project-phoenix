package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// guardianPickupDatabase resolves the caller's transaction for a pickup
// permission command. The command names its school; a tenant transaction must
// be scoped to the same one, while an administrative transaction (tenant zero)
// writes the named school directly.
func (s *Store) guardianPickupDatabase(ctx context.Context, tenantID int64, operation string) (bun.IDB, error) {
	if tenantID <= 0 {
		return nil, fmt.Errorf("care plan postgres: tenant is required to %s", operation)
	}
	db, scoped, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	if scoped > 0 && scoped != tenantID {
		return nil, fmt.Errorf("%w: %s", careplan.ErrGuardianPickupTenantMismatch, operation)
	}
	return db, nil
}

func (s *Store) CreateGuardianPickupPermission(ctx context.Context, permission careplan.GuardianPickupPermission) (domain.OperationStats, error) {
	db, err := s.guardianPickupDatabase(ctx, permission.TenantID, "create guardian pickup permission")
	if err != nil {
		return domain.OperationStats{}, err
	}
	return execAny(ctx, db.NewRaw(`INSERT INTO users.student_guardian_pickup_permissions
		(tenant_id, relationship_id, can_pickup, pickup_notes) VALUES (?, ?, ?, ?)`,
		permission.TenantID, permission.RelationshipID, permission.CanPickup, permission.PickupNotes),
		"create guardian pickup permission")
}

// ChangeGuardianPickupPermission writes the supplied columns. A change without
// any column only reports whether the permission exists. A change of the
// flag or the weekdays locks the stored state first and, where it withdraws
// weekdays, removes the contact's pickup persons of today and later on them
// in the same transaction (#8206).
func (s *Store) ChangeGuardianPickupPermission(ctx context.Context, change careplan.GuardianPickupPermissionChange) (bool, domain.OperationStats, error) {
	if change.CanPickup == nil && !change.SetWeekdays {
		return s.writeGuardianPickupPermission(ctx, change)
	}
	before, found, stats, err := s.lockGuardianPickupPermissionState(ctx, change.TenantID, change.RelationshipID)
	if err != nil || !found {
		return false, stats, err
	}
	written, writeStats, err := s.writeGuardianPickupPermission(ctx, change)
	stats.Add(writeStats)
	if err != nil || !written {
		return false, stats, err
	}
	withdrawn := domain.WithdrawnPickupWeekdays(before, domain.ChangedPickupPermission(before, change))
	removed, removeStats, err := s.deleteWithdrawnPickupPersons(ctx, change.TenantID, change.RelationshipID, withdrawn)
	stats.Add(removeStats)
	if err == nil && len(removed) > 0 && change.Removed != nil {
		change.Removed(removed)
	}
	return err == nil, stats, err
}

type pickupPermissionStateRow struct {
	CanPickup bool  `bun:"can_pickup"`
	Weekdays  []int `bun:"pickup_weekdays,array"`
}

// lockGuardianPickupPermissionState locks the permission row and reads the
// state a change starts from.
func (s *Store) lockGuardianPickupPermissionState(ctx context.Context, tenantID, relationshipID int64) (careplan.GuardianPickupPermissionState, bool, domain.OperationStats, error) {
	db, err := s.guardianPickupDatabase(ctx, tenantID, "lock guardian pickup permission state")
	if err != nil {
		return careplan.GuardianPickupPermissionState{}, false, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	var row pickupPermissionStateRow
	err = db.NewRaw(`SELECT can_pickup, pickup_weekdays FROM users.student_guardian_pickup_permissions
		WHERE tenant_id = ? AND relationship_id = ? FOR UPDATE`, tenantID, relationshipID).Scan(ctx, &row)
	stats.StatementDuration = time.Since(started)
	if errors.Is(err, sql.ErrNoRows) {
		return careplan.GuardianPickupPermissionState{}, false, stats, nil
	}
	if err != nil {
		return careplan.GuardianPickupPermissionState{}, false, stats, fmt.Errorf("care plan postgres: lock guardian pickup permission state: %w", err)
	}
	stats.Rows = 1
	return careplan.GuardianPickupPermissionState{CanPickup: row.CanPickup, Weekdays: row.Weekdays}, true, stats, nil
}

type removedPickupPersonRow struct {
	StudentID           int64         `bun:"student_id"`
	ExceptionDate       calendar.Date `bun:"exception_date,type:date"`
	PersonName          string        `bun:"person_name"`
	RequestedByGuardian *int64        `bun:"requested_by_guardian"`
}

// deleteWithdrawnPickupPersons removes the relationship's pickup persons whose
// plan weekday is withdrawn. The command carries no clock: a day before today
// is no longer shown anywhere and is due for the nightly retention, so taking
// it along changes nothing anybody sees. A weekend counts as Friday only for
// a tenant whose weekend follows Friday's plan.
func (s *Store) deleteWithdrawnPickupPersons(ctx context.Context, tenantID, relationshipID int64, weekdays []int) ([]careplan.RemovedPickupDay, domain.OperationStats, error) {
	if len(weekdays) == 0 {
		return nil, domain.OperationStats{}, nil
	}
	db, err := s.guardianPickupDatabase(ctx, tenantID, "delete withdrawn pickup persons")
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	weekendFollowsFriday, err := calendar.WeekendFollowsFriday(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, fmt.Errorf("care plan postgres: resolve weekend plan: %w", err)
	}
	rows := []removedPickupPersonRow{}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(`DELETE FROM schedule.student_pickup_persons
		WHERE tenant_id = ? AND relationship_id = ?
			AND (date_part('isodow', exception_date)::int <= 5 OR ?::bool)
			AND CASE WHEN ?::bool THEN LEAST(date_part('isodow', exception_date)::int, 5)
				ELSE date_part('isodow', exception_date)::int END = ANY(?::int[])
		RETURNING student_id, exception_date, person_name, requested_by_guardian`,
		tenantID, relationshipID, weekendFollowsFriday, weekendFollowsFriday, pgdialect.Array(weekdays)).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("care plan postgres: delete withdrawn pickup persons: %w", err)
	}
	stats.Rows = int64(len(rows))
	removed := make([]careplan.RemovedPickupDay, len(rows))
	for i, row := range rows {
		removed[i] = careplan.RemovedPickupDay{StudentID: row.StudentID, Date: row.ExceptionDate, Name: row.PersonName, RequestedByGuardian: row.RequestedByGuardian}
	}
	slices.SortFunc(removed, func(a, b careplan.RemovedPickupDay) int { return a.Date.Compare(b.Date) })
	return removed, stats, nil
}

// writeGuardianPickupPermission writes the supplied columns, or only reports
// whether the permission exists when none is supplied.
func (s *Store) writeGuardianPickupPermission(ctx context.Context, change careplan.GuardianPickupPermissionChange) (bool, domain.OperationStats, error) {
	db, err := s.guardianPickupDatabase(ctx, change.TenantID, "change guardian pickup permission")
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	if change.CanPickup == nil && !change.SetPickupNotes && !change.SetWeekdays {
		query := db.NewSelect().TableExpr(`users.student_guardian_pickup_permissions AS "pickup"`).
			Where(`"pickup".tenant_id = ?`, change.TenantID).
			Where(`"pickup".relationship_id = ?`, change.RelationshipID)
		stats := domain.OperationStats{Queries: 1}
		started := time.Now()
		exists, err := query.Exists(ctx)
		stats.StatementDuration = time.Since(started)
		if err != nil {
			return false, stats, fmt.Errorf("care plan postgres: find guardian pickup permission: %w", err)
		}
		return exists, stats, nil
	}
	query := db.NewUpdate().TableExpr(`users.student_guardian_pickup_permissions AS "pickup"`).
		Where(`"pickup".tenant_id = ?`, change.TenantID).
		Where(`"pickup".relationship_id = ?`, change.RelationshipID)
	if change.CanPickup != nil {
		query = query.Set("can_pickup = ?", *change.CanPickup)
	}
	if change.SetPickupNotes {
		query = query.Set("pickup_notes = ?", change.PickupNotes)
	}
	if change.SetWeekdays {
		if len(change.Weekdays) == 0 {
			query = query.Set("pickup_weekdays = NULL")
		} else {
			query = query.Set("pickup_weekdays = ?::smallint[]", pgdialect.Array(change.Weekdays))
		}
	}
	if change.Expected != nil {
		query = query.Where(`"pickup".can_pickup = ?`, change.Expected.CanPickup)
		if len(change.Expected.Weekdays) == 0 {
			query = query.Where(`"pickup".pickup_weekdays IS NULL`)
		} else {
			query = query.Where(`"pickup".pickup_weekdays = ?::smallint[]`, pgdialect.Array(change.Expected.Weekdays))
		}
	}
	stats, affected, err := execute(ctx, query, "change guardian pickup permission")
	return affected > 0, stats, err
}
