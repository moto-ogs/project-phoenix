package postgres

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// staffWorkTimeFactsQuery gathers, per staff member of one school, what an
// assignment of a template depends on (#6921): the bound template, whether a
// schedule version exists, whether a running contract of the Träger keeps the
// Soll (same condition as staffSollKeptExpr) and the latest closed month.
// Every source is filtered by the school; row security applies on top.
const staffWorkTimeFactsQuery = `WITH bound AS (
	SELECT profile.membership_id AS staff_id, profile.work_time_model_id
	FROM users.staff_employment_profiles AS profile
	WHERE profile.tenant_id = ?0 AND profile.work_time_model_id IS NOT NULL
), scheduled AS (
	SELECT DISTINCT schedule.staff_id FROM ` + tableStaffWorkSchedules + ` AS schedule WHERE schedule.tenant_id = ?0
), kept AS (
	SELECT DISTINCT target.membership_id AS staff_id
	FROM workforce.staff_contract_targets AS target
	JOIN workforce.staff_contracts AS contract ON contract.id = target.contract_id
	WHERE target.school_id = ?0 AND (contract.ends_on IS NULL OR contract.ends_on >= ?1)
), closed AS (
	SELECT snapshot.staff_id, MAX(snapshot.year * 12 + snapshot.month - 1) AS ordinal
	FROM ` + tableMonthSnapshots + ` AS snapshot
	WHERE snapshot.tenant_id = ?0 AND snapshot.reopened_at IS NULL
	GROUP BY snapshot.staff_id
), staff AS (
	SELECT staff_id FROM bound UNION SELECT staff_id FROM scheduled
	UNION SELECT staff_id FROM kept UNION SELECT staff_id FROM closed
)
SELECT staff.staff_id, bound.work_time_model_id,
	scheduled.staff_id IS NOT NULL AS has_schedule,
	kept.staff_id IS NOT NULL AS soll_kept_by_traeger,
	COALESCE(to_char(make_date(closed.ordinal / 12, closed.ordinal % 12 + 1, 1), 'YYYY-MM'), '') AS closed_through
FROM staff
LEFT JOIN bound USING (staff_id)
LEFT JOIN scheduled USING (staff_id)
LEFT JOIN kept USING (staff_id)
LEFT JOIN closed USING (staff_id)
ORDER BY staff.staff_id`

type staffWorkTimeFactRow struct {
	StaffID           int64  `bun:"staff_id"`
	WorkTimeModelID   *int64 `bun:"work_time_model_id"`
	HasSchedule       bool   `bun:"has_schedule"`
	SollKeptByTraeger bool   `bun:"soll_kept_by_traeger"`
	ClosedThrough     string `bun:"closed_through"`
}

// assignmentDatabase is the school's transaction handle; an assignment is
// always the act of one school.
func (s *Store) assignmentDatabase(ctx context.Context) (bun.IDB, int64, error) {
	db, scope, err := s.database(ctx)
	if err == nil && (scope.AcrossSchools || scope.TenantID <= 0) {
		err = errors.New("workforce postgres: work-time model assignment needs one school")
	}
	return db, scope.TenantID, err
}

func (s *Store) StaffWorkTimeFacts(ctx context.Context, today string) ([]domain.StaffWorkTimeFact, domain.OperationStats, error) {
	db, schoolID, err := s.assignmentDatabase(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	var rows []staffWorkTimeFactRow
	stats, err := scanAll(ctx, db.NewRaw(staffWorkTimeFactsQuery, schoolID, calendarDate(today)), "read staff work-time facts", &rows)
	if err != nil {
		return nil, stats, err
	}
	facts := make([]domain.StaffWorkTimeFact, 0, len(rows))
	for _, row := range rows {
		facts = append(facts, domain.StaffWorkTimeFact(row))
	}
	stats.Rows = int64(len(facts))
	return facts, stats, nil
}

// LockWorkTimeModel is the row lock an edit of the template writes under:
// it waits for an assignment that holds the row FOR SHARE, then the edit
// reads the template after it.
func (s *Store) LockWorkTimeModel(ctx context.Context, id int64) (bool, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	if err := tenant.OrderLock(ctx, tenant.LockWorkTimeModel, tenant.LockIDKey(id)); err != nil {
		return false, domain.OperationStats{}, err
	}
	row := &workTimeModelRow{}
	query := withTenant(db.NewSelect().
		Model(row).
		ModelTableExpr(tableWorkTimeModels+` AS "work_time_model"`).
		Column("work_time_model.id").
		Where(`"work_time_model".id = ?`, id).
		For("UPDATE"), "work_time_model", scope)
	return scanOne(ctx, query, "lock work-time model")
}

// ShareLockWorkTimeModel conflicts with the row lock an edit of the
// template takes. Taken before the staff locks, it orders an assignment and
// an edit the same way: template first, then the people.
func (s *Store) ShareLockWorkTimeModel(ctx context.Context, id int64) (bool, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return false, domain.OperationStats{}, err
	}
	if err := tenant.OrderLock(ctx, tenant.LockWorkTimeModel, tenant.LockIDKey(id)); err != nil {
		return false, domain.OperationStats{}, err
	}
	row := &workTimeModelRow{}
	query := withTenant(db.NewSelect().
		Model(row).
		ModelTableExpr(tableWorkTimeModels+` AS "work_time_model"`).
		Column("work_time_model.id").
		Where(`"work_time_model".id = ?`, id).
		For("SHARE"), "work_time_model", scope)
	return scanOne(ctx, query, "share-lock work-time model")
}

func (s *Store) StaffWorkTimeModelBindings(ctx context.Context, staffIDs []int64) (map[int64]int64, domain.OperationStats, error) {
	bindings := make(map[int64]int64, len(staffIDs))
	if len(staffIDs) == 0 {
		return bindings, domain.OperationStats{}, nil
	}
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	var rows []staffEmploymentRow
	stats, err := scanAll(ctx, staffEmploymentTenant(db.NewSelect().Model(&rows).
		Column("membership_id", "work_time_model_id").
		Where(`"profile".membership_id IN (?)`, bun.List(staffIDs)).
		Where(`"profile".work_time_model_id IS NOT NULL`), scope), "read work-time model bindings")
	if err != nil {
		return nil, stats, err
	}
	for _, row := range rows {
		if row.WorkTimeModelID != nil {
			bindings[row.MembershipID] = *row.WorkTimeModelID
		}
	}
	stats.Rows = int64(len(bindings))
	return bindings, stats, nil
}

func (s *Store) StaffSollKeptByTraeger(ctx context.Context, staffIDs []int64, day string) ([]int64, domain.OperationStats, error) {
	if len(staffIDs) == 0 {
		return nil, domain.OperationStats{}, nil
	}
	db, schoolID, err := s.assignmentDatabase(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	var kept []int64
	stats, err := scanAll(ctx, db.NewRaw(`SELECT DISTINCT target.membership_id FROM workforce.staff_contract_targets AS target
		JOIN workforce.staff_contracts AS contract ON contract.id = target.contract_id
		WHERE target.school_id = ? AND target.membership_id = ANY(?) AND (contract.ends_on IS NULL OR contract.ends_on >= ?)
		ORDER BY target.membership_id`,
		schoolID, pgdialect.Array(staffIDs), calendarDate(day)), "read staff with a Soll of the Träger", &kept)
	if err != nil {
		return nil, stats, err
	}
	stats.Rows = int64(len(kept))
	return kept, stats, nil
}

// BindStaffWorkTimeModel writes the template binding and the staff-level
// anchor of every given member in one statement. A missing profile is
// created; a profile of another school under the same ID is skipped by the
// conflict guard and reported as ErrStaffEmploymentNotFound.
func (s *Store) BindStaffWorkTimeModel(ctx context.Context, staffIDs []int64, workTimeModelID int64, anchorDate string) (domain.OperationStats, error) {
	if len(staffIDs) == 0 {
		return domain.OperationStats{}, nil
	}
	db, schoolID, err := s.assignmentDatabase(ctx)
	if err != nil {
		return domain.OperationStats{}, err
	}
	rows := make([]staffEmploymentRow, 0, len(staffIDs))
	for _, staffID := range staffIDs {
		modelID := workTimeModelID
		rows = append(rows, staffEmploymentRow{
			MembershipID: staffID, TenantID: schoolID, WorkTimeModelID: &modelID,
			RotationAnchorDate: optionalCalendarDate(anchorDate),
		})
	}
	stats, err := execAffected(ctx, db.NewInsert().Model(&rows).
		On(`CONFLICT (membership_id) DO UPDATE`).
		Set(`work_time_model_id = EXCLUDED.work_time_model_id`).
		Set(`rotation_anchor_date = EXCLUDED.rotation_anchor_date`).
		Where(`"profile".tenant_id = EXCLUDED.tenant_id`).
		Returning("NULL"), "bind work time model")
	if err != nil {
		return stats, err
	}
	if stats.Rows != int64(len(staffIDs)) {
		return stats, workforce.ErrStaffEmploymentNotFound
	}
	return stats, nil
}
