package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The links of categories to a Dienstplan shift type (#1837): the foreign
// key lives on activities.categories, so Timetable writes them for the
// shift-type administration of Workforce.

func (s *Service) SetCategoryShiftTypeLinks(ctx context.Context, shiftTypeID int64, categoryIDs []int64, expected map[int64]string) error {
	if shiftTypeID <= 0 || hasInvalidID(categoryIDs) {
		return s.reject("set_category_shift_type_links", timetable.ErrInvalidCategory)
	}

	return s.runWrite(ctx, "set_category_shift_type_links", true, func(txCtx context.Context, stats *domain.OperationStats) error {
		if expected != nil {
			if err := s.checkShiftTypeLinks(txCtx, shiftTypeID, categoryIDs, expected, stats); err != nil {
				return err
			}
		}
		queryStats, err := s.store.SetCategoryShiftTypeLinks(txCtx, shiftTypeID, categoryIDs)
		stats.Add(queryStats)
		return err
	})
}

// checkShiftTypeLinks locks the categories a link write may change (those
// linked to the shift type and those it links) and refuses the write when a
// category whose link it changes moved since the caller read it (ADR 0311).
// A category whose link stays as it is needs no token.
func (s *Service) checkShiftTypeLinks(ctx context.Context, shiftTypeID int64, categoryIDs []int64, expected map[int64]string, stats *domain.OperationStats) error {
	current, queryStats, err := s.store.LockShiftTypeLinkCategories(ctx, shiftTypeID, categoryIDs)
	stats.Add(queryStats)
	if err != nil {
		return err
	}
	requested := make(map[int64]bool, len(categoryIDs))
	for _, id := range categoryIDs {
		requested[id] = true
	}
	for _, category := range current {
		linked := category.ShiftTypeID != nil && *category.ShiftTypeID == shiftTypeID
		if linked == requested[category.ID] {
			continue
		}
		if err := readstate.Check(expected[category.ID], timetable.CategoryShiftTypeLinkVersion(category)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) SetCategoryShiftTypeID(ctx context.Context, id int64, shiftTypeID *int64) error {
	if id <= 0 || (shiftTypeID != nil && *shiftTypeID <= 0) {
		return s.reject("set_category_shift_type_id", timetable.ErrInvalidCategory)
	}

	return s.runWrite(ctx, "set_category_shift_type_id", true, func(txCtx context.Context, stats *domain.OperationStats) error {
		queryStats, err := s.store.SetCategoryShiftTypeID(txCtx, id, shiftTypeID)
		stats.Add(queryStats)
		return err
	})
}
