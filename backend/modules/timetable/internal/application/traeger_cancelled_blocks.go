package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ timetable.TraegerCancelledBlocks = (*Service)(nil)

// CancelledBlocksByTenant counts the cancelled blocks of the day per school
// (#7672). It joins the caller's administrative transaction instead of
// opening a school transaction; an empty school set reads nothing.
func (s *Service) CancelledBlocksByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error) {
	result := map[int64]int{}
	if len(schools) == 0 {
		return result, nil
	}
	err := s.observeOperation(ctx, "cancelled_blocks_by_tenant", func(ctx context.Context, stats *domain.OperationStats) error {
		counts, queryStats, err := s.store.CountCancelledInstancesByTenant(ctx, schools, day)
		stats.Add(queryStats)
		for school, count := range counts {
			if count > 0 {
				result[school] = count
			}
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
