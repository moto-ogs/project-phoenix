package application

import (
	"context"
	"time"

	"github.com/uptrace/bun"
)

// dbTenantDirectory lists the seeded schools straight from platform.schools
// so the wired scheduler tests run against the real tenant fixtures.
// Callers pass the pool from testpkg.SetupTestDB.
type dbTenantDirectory struct{ db *bun.DB }

func (d dbTenantDirectory) ListActiveTenantIDs(ctx context.Context) ([]int64, error) {
	ids := []int64{}
	err := d.db.NewSelect().
		TableExpr(`platform.schools AS "school"`).
		Column("school.id").
		Where(`"school".deleted_at IS NULL`).
		Where(`"school".active = TRUE`).
		OrderExpr(`"school".name ASC`).
		Scan(ctx, &ids)
	return ids, err
}

func (d dbTenantDirectory) ListCleanupTenantIDs(ctx context.Context) ([]int64, error) {
	var ids []int64
	err := d.db.NewSelect().TableExpr(`platform.schools AS "school"`).Column("school.id").
		OrderExpr(`"school".name ASC`).Scan(ctx, &ids)
	return ids, err
}

// RecordDueBillingKeyDates captures nothing: the wired scheduler tests cover
// the tenant loops, and the billing capture has its own owner tests.
func (d dbTenantDirectory) RecordDueBillingKeyDates(context.Context, time.Time) (int, error) {
	return 0, nil
}

// PublishSchoolNames names nothing: the analytics school names have their own
// tick and tracker tests.
func (d dbTenantDirectory) PublishSchoolNames(context.Context) (int, error) {
	return 0, nil
}

// HoldLiveSchool reads the school's live state without a lock: the wired
// scheduler tests cover the tenant loops; the hold has its root test.
func (d dbTenantDirectory) HoldLiveSchool(ctx context.Context, tenantID int64) (bool, error) {
	var live bool
	err := d.db.NewSelect().TableExpr(`platform.schools AS "school"`).
		ColumnExpr(`"school".active AND "school".deleted_at IS NULL`).
		Where(`"school".id = ?`, tenantID).Scan(ctx, &live)
	return live, err
}
