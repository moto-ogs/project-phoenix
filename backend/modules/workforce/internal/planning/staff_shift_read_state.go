package planning

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// checkShiftRead refuses a write over a shift changed since the planner read
// it (ADR 0311). The caller re-read the row after the staff-shift locks every
// writer of it takes. A nil read is a write no person read.
func checkShiftRead(read *workforce.ShiftReadState, stored *workforce.ShiftRecord) error {
	if read == nil {
		return nil
	}
	return readstate.Check(read.Version, workforce.ShiftVersion(stored.UpdatedAt))
}

// checkCancellationRead refuses a cancellation whose planner read another
// state of the shift or of its covers: the covers are deleted and rebuilt
// from the request, so a cover added, changed or removed since would be lost
// or come back. Every stored cover needs its read version, and no cover may
// have been read that is gone.
func checkCancellationRead(read *workforce.ShiftReadState, origin *workforce.ShiftRecord, covers []*workforce.ShiftRecord) error {
	if err := checkShiftRead(read, origin); err != nil || read == nil {
		return err
	}
	if len(read.Replacements) != len(covers) {
		return readstate.ErrChanged
	}
	for _, cover := range covers {
		expected, ok := read.Replacements[cover.ID]
		if !ok {
			return readstate.ErrChanged
		}
		if err := readstate.Check(expected, workforce.ShiftVersion(cover.UpdatedAt)); err != nil {
			return err
		}
	}
	return nil
}

// ensureShiftUnchangedWhileLocking re-reads the row after locking.
//
// A normal edit may have loaded the row before a concurrent MoveShift acquired
// this same lock. Re-read after locking and reject every move-relevant change,
// including a same-person date/window move: otherwise the stale edit payload
// would silently move the row back. UpdatedAt additionally catches other
// concurrent whole-row updates while this request waited.
func (s *staffShiftService) ensureShiftUnchangedWhileLocking(ctx context.Context, id int64, existing *workforce.ShiftRecord, read *workforce.ShiftReadState) error {
	lockedExisting, err := s.findShiftOrNotFound(ctx, id, "reload staff shift after lock")
	if err != nil {
		return err
	}
	if err := checkShiftRead(read, lockedExisting); err != nil {
		return err
	}
	if staffShiftMoveChanged(existing, lockedExisting) ||
		!lockedExisting.UpdatedAt.Equal(existing.UpdatedAt) {
		return fmt.Errorf("%w: shift changed while the edit was waiting for its write lock", ErrShiftConflict)
	}
	return nil
}
