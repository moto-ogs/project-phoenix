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
	// Each column takes the value at the row's position in the id array: one
	// statement without a derived table.
	query := withTenant(db.NewUpdate().
		Model((*staffShiftRow)(nil)).
		ModelTableExpr(tableStaffShifts+` AS "staff_shift"`).
		Set(`cancelled = (?::boolean[])[array_position(?::bigint[], "staff_shift".id)]`, pgdialect.Array(cancelled), pgdialect.Array(ids)).
		Set(`change_reason = NULLIF((?::text[])[array_position(?::bigint[], "staff_shift".id)], '')`, pgdialect.Array(reasons), pgdialect.Array(ids)).
		Set(`sick_absence_id = NULLIF((?::bigint[])[array_position(?::bigint[], "staff_shift".id)], 0)`, pgdialect.Array(absences), pgdialect.Array(ids)).
		Set(`detached = (?::boolean[])[array_position(?::bigint[], "staff_shift".id)]`, pgdialect.Array(detached), pgdialect.Array(ids)).
		Where(`"staff_shift".id = ANY(?)`, pgdialect.Array(ids)), aliasStaffShift, scope)
	return execCount(ctx, query, "apply staff shift break day states")
}
