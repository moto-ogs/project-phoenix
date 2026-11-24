package planning

import (
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
