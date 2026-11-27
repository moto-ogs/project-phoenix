package planning

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// refuseWhenPlanningOff refuses a new shift while the Träger plans outside
// moto (ADR 0242 point 6).
func (s *staffShiftService) refuseWhenPlanningOff(ctx context.Context) error {
	return s.Guard.ensurePlanningOn(ctx)
}

// writeCheckedShift checks the shift against the school's other shifts of
// the person and the working-time rules over every Einsatzort, writes it and
// records a confirmed override in the same unit (#4708, ADR 0242). stored
// is the state the write replaces: the edited shift or the cover a rebuilt
// one stands in for; nil for a new shift.
func (s *staffShiftService) writeCheckedShift(ctx context.Context, shift, stored *workforce.ShiftRecord, actorStaffID int64, write func() (workforce.StaffShift, error)) error {
	if err := s.checkOverlap(ctx, shift); err != nil {
		return err
	}
	var before []*workforce.ShiftRecord
	if stored != nil {
		before = []*workforce.ShiftRecord{stored}
	}
	override, err := s.Guard.check(ctx, shift.StaffID, before, []*workforce.ShiftRecord{shift}, shift.WorkingTime)
	if err != nil {
		return err
	}
	written, err := write()
	if err != nil {
		return err
	}
	applyShiftToRow(shift, written)
	return s.Guard.record(ctx, override, shift, nil, actorStaffID)
}
