package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// ApplyBreakDayShiftStates writes the states the break-day follow-up decided
// (#8205) in one statement of the caller's write transaction. A state that
// names no shift is refused before anything is written.
func (s *Service) ApplyBreakDayShiftStates(ctx context.Context, states []workforce.BreakDayShiftState) error {
	values := make([]domain.StaffShiftBreakDayState, 0, len(states))
	for _, state := range states {
		if state.ShiftID <= 0 {
			return invalidShift("break day state needs a shift ID")
		}
		values = append(values, domain.StaffShiftBreakDayState{
			ShiftID: state.ShiftID, Cancelled: state.Cancelled, ChangeReason: state.ChangeReason,
			SickAbsenceID: state.SickAbsenceID, Detached: state.Detached,
		})
	}
	if len(values) == 0 {
		return nil
	}
	err := s.run(ctx, "apply_break_day_shift_states", func(ctx context.Context, stats *domain.OperationStats) error {
		return s.transaction.RunWrite(ctx, func(txCtx context.Context) error {
			_, writeStats, err := s.store.ApplyStaffShiftBreakDayStates(txCtx, values)
			stats.Add(writeStats)
			return err
		})
	})
	return mapShiftError(err)
}
