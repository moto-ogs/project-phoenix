package timetable

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomBlockStaffQuery names the staff planned on the blocks of one room
// between two days, both included (#8234): the people a closure of the room
// concerns. A block that is cancelled, completed or that the staff member
// misses (absent) does not count. The read applies no visibility of its own;
// it serves the notice of Facilities' closure, which only staff with
// rooms:update write.
type RoomBlockStaffQuery interface {
	RoomBlockStaffIDs(ctx context.Context, roomID int64, from, until calendar.Date) ([]int64, error)
}

// ErrNoRoomBlockStaff reports room reference queries without the read.
var ErrNoRoomBlockStaff = errors.New("timetable: the room reference queries name no room block staff")

// RoomBlockStaffOf is the room block staff read of the room reference
// queries the owner composed.
func RoomBlockStaffOf(references RoomReferenceQuery) (RoomBlockStaffQuery, error) {
	staff, ok := references.(RoomBlockStaffQuery)
	if !ok {
		return nil, ErrNoRoomBlockStaff
	}
	return staff, nil
}

// RoomBlockStaffRow is one staff row of a planned block in the room: the
// member and whether it is marked absent on the block.
type RoomBlockStaffRow struct {
	StaffID int64
	Absent  bool
}

// PlannedRoomQuery names the rooms of the day's blocks the staff member is
// planned on and takes part in: not cancelled, not marked absent (#8234,
// "Heute anders" under "Betrifft dich"). Inside a "Heute anders" request it
// filters the day's shared staff rows instead of a statement of its own.
type PlannedRoomQuery interface {
	PlannedRoomIDs(ctx context.Context, staffID int64, date calendar.Date) ([]int64, error)
}
