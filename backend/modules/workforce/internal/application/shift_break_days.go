package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// ApplyBreakDayShiftStates writes the states the break-day follow-up decided
// (#8205) in one statement. It opens no unit of its own: the store requires
// the closing day's write transaction, under the staff-shift gates the
// follow-up took. A state that names no shift is refused before anything is
// written.
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
	_, _, err := s.store.ApplyStaffShiftBreakDayStates(ctx, values)
	return mapShiftError(err)
}
