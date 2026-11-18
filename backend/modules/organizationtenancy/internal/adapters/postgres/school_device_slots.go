package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// deviceSlotLockKey is the advisory-lock namespace of the Geräteplätze
// ("gera", #2312); platform.lock_school_device_slots takes the same key. A limit change and a device registration of one school
// hold it until their transaction ends, so a registration never commits
// against a limit that is lowered meanwhile and two registrations never
// take the same last place.
const deviceSlotLockKey = int32(0x67657261)

// LockSchoolDeviceSlots holds the per-school Geräteplatz lock until the
// caller's transaction completes.
func (s *Store) LockSchoolDeviceSlots(ctx context.Context, id int64) (domain.OperationStats, error) {
	db, err := s.database(ctx)
	if err != nil {
		return domain.OperationStats{}, err
	}
	if id <= 0 || id > 0x7fffffff {
		return domain.OperationStats{}, errors.New("organization tenancy: valid school is required")
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	_, err = db.NewRaw("SELECT pg_advisory_xact_lock(?, ?)", deviceSlotLockKey, int32(id)).Exec(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return stats, fmt.Errorf("organization tenancy postgres: lock school device slots: %w", err)
	}
	return stats, nil
}

// SetSchoolDeviceSlots replaces the school's Geräteplätze; nil removes the
// limit.
func (s *Store) SetSchoolDeviceSlots(ctx context.Context, id int64, slots *int) (organizationtenancy.School, domain.OperationStats, error) {
	db, err := s.database(ctx)
	if err != nil {
		return organizationtenancy.School{}, domain.OperationStats{}, err
	}
	row := schoolRow{}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewUpdate().Model(&row).
		ModelTableExpr(`platform.schools AS "school"`).
		Set("device_slots = ?", slots).
		Where(`"school".id = ?`, id).
		Returning("*").
		Scan(ctx)
	stats.StatementDuration = time.Since(started)
	if errors.Is(err, sql.ErrNoRows) {
		return organizationtenancy.School{}, stats, organizationtenancy.ErrSchoolNotFound
	}
	if err != nil {
		return organizationtenancy.School{}, stats, fmt.Errorf("organization tenancy postgres: set school device slots: %w", err)
	}
	stats.Rows = 1
	return toSchoolDomain(row), stats, nil
}

// readDeviceSlots reads the Geräteplätze of the school in context on the
// caller's transaction, after taking the per-school lock when lock is set
// (platform.lock_school_device_slots, one statement). The caller supplies the
// tenant from its context, never from input.
func readDeviceSlots(ctx context.Context, lock bool) (int, bool, error) {
	tenantID, err := tenant.TenantFromContext(ctx)
	if err != nil {
		return 0, false, fmt.Errorf("organization tenancy: device slots: %w", err)
	}
	db, err := composedTransaction(ctx)
	if err != nil {
		return 0, false, fmt.Errorf("organization tenancy: device slots: %w", err)
	}
	schoolID := tenantID.Int64()
	var row struct {
		Slots *int `bun:"device_slots"`
	}
	if lock {
		if schoolID <= 0 || schoolID > 0x7fffffff {
			return 0, false, errors.New("organization tenancy: device slots: valid school is required")
		}
		// The function takes the lock and then reads with a fresh snapshot,
		// so a limit lowered while this transaction waited is seen.
		err = db.NewRaw(`SELECT device_slots FROM platform.lock_school_device_slots(?)`, schoolID).Scan(ctx, &row)
	} else {
		err = db.NewSelect().
			TableExpr(`platform.schools AS "school"`).
			ColumnExpr(`"school".device_slots`).
			Where(`"school".id = ?`, schoolID).
			Scan(ctx, &row)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, organizationtenancy.ErrSchoolNotFound
	}
	if err != nil {
		return 0, false, fmt.Errorf("organization tenancy postgres: read device slots: %w", err)
	}
	if row.Slots == nil {
		return 0, false, nil
	}
	return *row.Slots, true, nil
}

// composedTransaction is the caller's tenant or administrative transaction.
func composedTransaction(ctx context.Context) (bun.IDB, error) {
	transaction, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return nil, errors.New("transaction is required")
	}
	switch tx := transaction.(type) {
	case bun.Tx:
		return tx, nil
	case *bun.Tx:
		if tx != nil {
			return tx, nil
		}
	}
	return nil, fmt.Errorf("unsupported transaction %T", transaction)
}

// ComposedSchoolLimits is the tenant-safe read of a school's contract limits
// on the caller's transaction: the Kinderkontingent (#3567) and the
// Geräteplätze (#2312).
type ComposedSchoolLimits struct{}

func (ComposedSchoolLimits) ChildQuotaLimit(ctx context.Context) (int, bool, error) {
	return ReadComposedChildQuota(ctx)
}

func (ComposedSchoolLimits) LockDeviceSlotLimit(ctx context.Context) (int, bool, error) {
	return readDeviceSlots(ctx, true)
}

func (ComposedSchoolLimits) DeviceSlotLimit(ctx context.Context) (int, bool, error) {
	return readDeviceSlots(ctx, false)
}
