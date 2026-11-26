package timetable

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// BlockDayChange is one block of a day that does not run as planned (#7662):
// it is cancelled, its cancellation was taken back, it lies in another room
// than its series plans, or somebody covers for a planned supervisor. It
// carries no reason: neither the cancellation's nor an absence's.
type BlockDayChange struct {
	InstanceID int64
	Title      string
	// StartTime and EndTime are the block's wall clock, "HH:MM".
	StartTime string
	EndTime   string
	RoomID    int64
	RoomName  string
	// Cancelled: the block does not take place today.
	Cancelled bool
	// Reinstated: the protocol's last word on today's block is the taking
	// back of its cancellation (#7151); the block takes place again.
	Reinstated bool
	// RegularRoomID and RegularRoomName are the series' planned room when the
	// block lies elsewhere today; zero otherwise.
	RegularRoomID   int64
	RegularRoomName string
	// SubstituteStaffIDs cover today; AbsentStaffIDs are the planned
	// supervisors who are not there. Both empty on a cancelled block.
	SubstituteStaffIDs []int64
	AbsentStaffIDs     []int64
	// Involved marks a block the caller is planned for, as supervisor,
	// substitute or absent supervisor.
	Involved bool
}

// RoomChanged reports a block in another room than its series plans.
func (c BlockDayChange) RoomChanged() bool { return c.RegularRoomID != 0 }

// LeadChanged reports a block somebody covers for, or one a planned
// supervisor misses.
func (c BlockDayChange) LeadChanged() bool {
	return len(c.SubstituteStaffIDs) > 0 || len(c.AbsentStaffIDs) > 0
}

// BlockDayChangeQuery reads the changed blocks of a day as the caller may see
// them on the day plan: every block under the operational overview, otherwise
// the blocks the caller is planned for (#7662, "Heute anders").
type BlockDayChangeQuery interface {
	BlockDayChanges(ctx context.Context, accountID int64, isAdmin bool, date calendar.Date) ([]BlockDayChange, error)
}

// ErrNoBlockDayChanges reports an operational day without the read.
var ErrNoBlockDayChanges = errors.New("timetable operations: the operational day reads no changed blocks")

// BlockDayChangesOf is the read of the changed blocks of an operational day
// the owner composed; the operational day reads its own blocks.
func BlockDayChangesOf(day OperationCapability) (BlockDayChangeQuery, error) {
	changes, ok := day.(BlockDayChangeQuery)
	if !ok {
		return nil, ErrNoBlockDayChanges
	}
	return changes, nil
}

// ChildBlockDayChangeQuery reads the changed blocks of a day one child is
// planned on, for the parents' "Heute anders" (#7671). The caller has checked
// the guardian's relationship permission; staff travel as ids only.
type ChildBlockDayChangeQuery interface {
	ChildBlockDayChanges(ctx context.Context, studentID int64, date calendar.Date) ([]BlockDayChange, error)
}

// ChildBlockDayChangesOf is the child read of the operational day the owner
// composed.
func ChildBlockDayChangesOf(day OperationCapability) (ChildBlockDayChangeQuery, error) {
	changes, ok := day.(ChildBlockDayChangeQuery)
	if !ok {
		return nil, ErrNoBlockDayChanges
	}
	return changes, nil
}
