package postgres

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// ApplyStaffShiftBreakDayStates writes the states of the break-day follow-up
// (#8205) in one statement: cancelled with a label, or planned again. An
// empty label and a zero absence write NULL.
func (s *Store) ApplyStaffShiftBreakDayStates(ctx context.Context, states []domain.StaffShiftBreakDayState) (int64, domain.OperationStats, error) {
	if len(states) == 0 {
		return 0, domain.OperationStats{}, nil
	}
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, domain.OperationStats{}, err
	}
	ids := make([]int64, len(states))
	cancelled := make([]bool, len(states))
	reasons := make([]string, len(states))
	absences := make([]int64, len(states))
	detached := make([]bool, len(states))
	for i, state := range states {
		ids[i], cancelled[i], detached[i] = state.ShiftID, state.Cancelled, state.Detached
		if state.ChangeReason != nil {
			reasons[i] = *state.ChangeReason
		}
		if state.SickAbsenceID != nil {
			absences[i] = *state.SickAbsenceID
		}
	}
	query := withTenant(db.NewUpdate().
		Model((*staffShiftRow)(nil)).
		ModelTableExpr(tableStaffShifts+` AS "staff_shift"`).
		TableExpr(`(SELECT unnest(?::bigint[]) AS id, unnest(?::boolean[]) AS cancelled, unnest(?::text[]) AS change_reason,
			unnest(?::bigint[]) AS sick_absence_id, unnest(?::boolean[]) AS detached) AS break_state`,
			pgdialect.Array(ids), pgdialect.Array(cancelled), pgdialect.Array(reasons), pgdialect.Array(absences), pgdialect.Array(detached)).
		Set("cancelled = break_state.cancelled").
		Set("change_reason = NULLIF(break_state.change_reason, '')").
		Set("sick_absence_id = NULLIF(break_state.sick_absence_id, 0)").
		Set("detached = break_state.detached").
		Where(`"staff_shift".id = break_state.id`), aliasStaffShift, scope)
	return execCount(ctx, query, "apply staff shift break day states")
}
