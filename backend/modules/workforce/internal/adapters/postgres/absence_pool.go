package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// The one Kontingent of a Personalakte over all its schools (#4710). The
// database functions workforce.absence_pool_claims and
// workforce.absence_pool_uses answer a school that is an Einsatzort of the
// record, in its tenant transaction, and the record's Träger, in the Träger
// transaction; anyone else gets no rows.

type absencePoolClaimRow struct {
	TraegerTypeID    int64    `bun:"traeger_absence_type_id"`
	AllowanceEnabled *bool    `bun:"allowance_enabled"`
	StandardDays     *float64 `bun:"standard_days"`
	CarryoverUntil   *string  `bun:"carryover_until"`
	FirstYear        *int     `bun:"first_year"`
	Year             *int     `bun:"year"`
	EntitledDays     *float64 `bun:"entitled_days"`
}

type absencePoolUseRow struct {
	TraegerTypeID int64        `bun:"traeger_absence_type_id"`
	AbsenceID     int64        `bun:"absence_id"`
	SchoolID      *int64       `bun:"school_id"`
	DateStart     calendarDate `bun:"date_start"`
	DateEnd       calendarDate `bun:"date_end"`
	HalfDay       bool         `bun:"half_day"`
	StartHalfDay  bool         `bun:"start_half_day"`
	EndHalfDay    bool         `bun:"end_half_day"`
	Status        string       `bun:"status"`
	CreatedAt     time.Time    `bun:"created_at"`
}

func readAbsencePoolClaims(ctx context.Context, db bun.IDB, recordID int64, typeIDs []int64, lock bool) (map[int64]domain.AbsencePoolType, error) {
	var rows []absencePoolClaimRow
	if err := db.NewRaw(`SELECT * FROM workforce.absence_pool_claims(?, ?, ?)`, recordID, pgdialect.Array(typeIDs), lock).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read absence pool claims: %w", err)
	}
	result := make(map[int64]domain.AbsencePoolType, len(typeIDs))
	for _, row := range rows {
		value := result[row.TraegerTypeID]
		value.TraegerTypeID = row.TraegerTypeID
		if value.Individual == nil {
			value.Individual = map[int]float64{}
		}
		if row.Year != nil && row.EntitledDays != nil {
			value.Individual[*row.Year] = *row.EntitledDays
		} else {
			value.AllowanceEnabled = row.AllowanceEnabled != nil && *row.AllowanceEnabled
			if row.StandardDays != nil {
				value.StandardDays = *row.StandardDays
			}
			if row.CarryoverUntil != nil {
				value.CarryoverUntil = *row.CarryoverUntil
			}
			if row.FirstYear != nil {
				value.FirstYear = *row.FirstYear
			}
		}
		result[row.TraegerTypeID] = value
	}
	return result, nil
}

func readAbsencePoolUses(ctx context.Context, db bun.IDB, recordID int64, typeIDs []int64, from, to string) ([]domain.AbsencePoolUse, error) {
	var rows []absencePoolUseRow
	if err := db.NewRaw(`SELECT * FROM workforce.absence_pool_uses(?, ?, ?::date, ?::date)`,
		recordID, pgdialect.Array(typeIDs), from, to).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read absence pool uses: %w", err)
	}
	result := make([]domain.AbsencePoolUse, 0, len(rows))
	for _, row := range rows {
		use := domain.AbsencePoolUse{TraegerTypeID: row.TraegerTypeID, Absence: domain.StaffAbsence{
			ID: row.AbsenceID, DateStart: string(row.DateStart), DateEnd: string(row.DateEnd), HalfDay: row.HalfDay,
			StartHalfDay: row.StartHalfDay, EndHalfDay: row.EndHalfDay, Status: row.Status, CreatedAt: row.CreatedAt,
		}}
		if row.SchoolID != nil {
			use.SchoolID = *row.SchoolID
		}
		result = append(result, use)
	}
	return result, nil
}

// AbsencePoolRecord returns the Personalakte that keeps the school's
// employment staffID, 0 without one. RLS shows a school only its own links.
func (s *Store) AbsencePoolRecord(ctx context.Context, staffID int64) (int64, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	var ids []int64
	err = db.NewRaw(`SELECT staff_record_id FROM workforce.staff_record_links WHERE school_id = ? AND membership_id = ?`,
		scope.TenantID, staffID).Scan(ctx, &ids)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return 0, stats, fmt.Errorf("workforce postgres: read absence pool record: %w", err)
	}
	if len(ids) == 0 {
		return 0, stats, nil
	}
	stats.Rows = 1
	return ids[0], stats, nil
}

// AbsencePoolClaims holds the Kontingente of the Träger's types typeIDs for
// the record until the school's tenant transaction ends, so no other school
// books the same rest, and reads the claims under that lock.
func (s *Store) AbsencePoolClaims(ctx context.Context, recordID int64, typeIDs []int64) (map[int64]domain.AbsencePoolType, domain.OperationStats, error) {
	db, _, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	claims, err := readAbsencePoolClaims(ctx, db, recordID, typeIDs, true)
	stats.StatementDuration = time.Since(started)
	stats.Rows = int64(len(claims))
	return claims, stats, err
}

// AbsencePoolUses reads the bookings of the Träger's types typeIDs at every
// Einsatzort of the record that overlap [from, to]; other schools stay
// unnamed.
func (s *Store) AbsencePoolUses(ctx context.Context, recordID int64, typeIDs []int64, from, to string) ([]domain.AbsencePoolUse, domain.OperationStats, error) {
	db, _, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	uses, err := readAbsencePoolUses(ctx, db, recordID, typeIDs, from, to)
	stats.StatementDuration = time.Since(started)
	stats.Rows = int64(len(uses))
	return uses, stats, err
}
