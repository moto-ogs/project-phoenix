package timetable

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TraegerCancelledBlocks counts the blocks of a day that are cancelled, per
// school, for "Heute anders" in the Träger-Portal (#7672). A block whose
// cancellation was taken back is planned again and does not count. The count
// names no block, no person and no reason.
//
// The caller runs it in the administrative transaction of the Träger
// projection; it reads only the given schools. The map holds only schools
// with a cancelled block.
type TraegerCancelledBlocks interface {
	CancelledBlocksByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error)
}

// ErrNoTraegerCancelledBlocks reports an owner without the count.
var ErrNoTraegerCancelledBlocks = errors.New("timetable: the owner counts no cancelled blocks of a Träger")

// TraegerCancelledBlocksOf is the count of the cancelled blocks the owner
// composed; the owner reads its own instances.
func TraegerCancelledBlocksOf(owner Owner) (TraegerCancelledBlocks, error) {
	blocks, ok := owner.(TraegerCancelledBlocks)
	if !ok {
		return nil, ErrNoTraegerCancelledBlocks
	}
	return blocks, nil
}
