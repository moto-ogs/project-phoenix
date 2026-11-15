package application

import (
	"context"
	"fmt"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// The one Kontingent of a Personalakte over all its schools (#4710, ADR 0089
// section 10 with its addendum of 14.11.2026). For a type of the Träger and
// a staff member with a Personalakte the school's own claims do not count:
// the Träger's claim does, and every booking of the type at every Einsatzort
// of the record draws on it.

// poolAccountsFor returns the accounts of the Träger's types among types
// that the staff member's Personalakte keeps, keyed by the school's type ID.
// It is empty without a Personalakte or without such a type. Reading holds
// the Kontingente until the school's transaction ends.
func (s *Service) poolAccountsFor(ctx context.Context, staffID int64, types []domain.StaffAbsenceType, firstYear, lastYear int) (map[int64]allowanceAccounts, error) {
	traegerIDs := make([]int64, 0, len(types))
	for _, absenceType := range types {
		if absenceType.KeptByTraeger() && absenceType.AllowanceEnabled {
			traegerIDs = append(traegerIDs, *absenceType.TraegerAbsenceTypeID)
		}
	}
	if len(traegerIDs) == 0 {
		return nil, nil
	}
	recordID, err := s.absencePoolRecord(ctx, staffID)
	if err != nil || recordID == 0 {
		return nil, err
	}
	var claims map[int64]domain.AbsencePoolType
	err = s.run(ctx, "absence_pool_claims", func(ctx context.Context, stats *domain.OperationStats) error {
		var queryStats domain.OperationStats
		claims, queryStats, err = s.store.AbsencePoolClaims(ctx, recordID, traegerIDs)
		stats.Add(queryStats)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("load absence pool claims: %w", err)
	}
	from, to := firstYear, domain.AllowanceExpiresOn(lastYear, "")
	for _, claim := range claims {
		from = min(from, claim.WindowStart(firstYear))
		to = max(to, domain.AllowanceExpiresOn(lastYear, claim.CarryoverUntil))
	}
	var uses []domain.AbsencePoolUse
	err = s.run(ctx, "absence_pool_uses", func(ctx context.Context, stats *domain.OperationStats) error {
		var queryStats domain.OperationStats
		uses, queryStats, err = s.store.AbsencePoolUses(ctx, recordID, traegerIDs, fmt.Sprintf("%04d-01-01", from), to)
		stats.Add(queryStats)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("load absence pool uses: %w", err)
	}
	return s.poolAccounts(types, claims, uses, firstYear, lastYear)
}

func (s *Service) absencePoolRecord(ctx context.Context, staffID int64) (int64, error) {
	var recordID int64
	err := s.run(ctx, "absence_pool_record", func(ctx context.Context, stats *domain.OperationStats) error {
		var queryStats domain.OperationStats
		var err error
		recordID, queryStats, err = s.store.AbsencePoolRecord(ctx, staffID)
		stats.Add(queryStats)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("load absence pool record: %w", err)
	}
	return recordID, nil
}

func (s *Service) poolAccounts(types []domain.StaffAbsenceType, claims map[int64]domain.AbsencePoolType, uses []domain.AbsencePoolUse, firstYear, lastYear int) (map[int64]allowanceAccounts, error) {
	result := make(map[int64]allowanceAccounts, len(claims))
	for _, absenceType := range types {
		if !absenceType.KeptByTraeger() {
			continue
		}
		claim, ok := claims[*absenceType.TraegerAbsenceTypeID]
		if !ok || !claim.AllowanceEnabled {
			continue
		}
		accounts, err := s.poolAccount(absenceType, claim, uses, firstYear, lastYear)
		if err != nil {
			return nil, err
		}
		result[absenceType.ID] = accounts
	}
	return result, nil
}

func (s *Service) poolAccount(absenceType domain.StaffAbsenceType, claim domain.AbsencePoolType, uses []domain.AbsencePoolUse, firstYear, lastYear int) (allowanceAccounts, error) {
	absenceType.CarryoverUntil = claim.CarryoverUntil
	accounts := allowanceAccounts{
		absenceType:  absenceType,
		entitlements: claim.Entitlements(claim.WindowStart(firstYear), lastYear+1),
		pooled:       true,
		local:        map[int64]bool{},
	}
	for _, use := range uses {
		if use.TraegerTypeID != claim.TraegerTypeID {
			continue
		}
		days, err := s.allowanceUses(use.Absence)
		if err != nil {
			return allowanceAccounts{}, err
		}
		accounts.uses = append(accounts.uses, days...)
		if use.SchoolID != 0 {
			accounts.local[use.Absence.ID] = true
		}
	}
	return accounts, nil
}

// localDays is what the bookings at this school, plus extra, take per
// calendar year. Without a Personalakte every booking is local.
func (a allowanceAccounts) localDays(extra []domain.AllowanceUse) map[int]float64 {
	days := map[int]float64{}
	add := func(use domain.AllowanceUse) {
		if year, err := strconv.Atoi(use.Day[:4]); err == nil {
			days[year] += use.Days
		}
	}
	for _, use := range a.uses {
		if !a.pooled || a.local[use.AbsenceID] {
			add(use)
		}
	}
	for _, use := range extra {
		add(use)
	}
	return days
}

// schoolLimitExceeded applies the school's deviation for a Träger's type:
// its bookings may take at most the limit per person and year.
func (a allowanceAccounts) schoolLimitExceeded(additional []domain.AllowanceUse) bool {
	limit := a.absenceType.SchoolLimitDays
	if limit == nil || !a.absenceType.KeptByTraeger() {
		return false
	}
	return domain.SchoolLimitExceeded(*limit, a.localDays(nil), a.localDays(additional)) != 0
}
