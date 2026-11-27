package application

import (
	"context"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	internalports "github.com/moto-ogs/project-phoenix/modules/timetable/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomBlockStaffRecords is the store read behind RoomBlockStaffQuery.
type RoomBlockStaffRecords interface {
	ListRoomBlockStaff(ctx context.Context, roomID int64, from, until calendar.Date) ([]timetable.RoomBlockStaffRow, domain.OperationStats, error)
}

// NewRoomBlockStaffQueries answers which staff a closure of a room concerns
// (#8234).
func NewRoomBlockStaffQueries(store RoomBlockStaffRecords, observe func(internalports.Observation)) timetable.RoomBlockStaffQuery {
	return roomBlockStaffQueries{store: store, observe: observe}
}

type roomBlockStaffQueries struct {
	store   RoomBlockStaffRecords
	observe func(internalports.Observation)
}

// RoomBlockStaffIDs reads in the caller's tenant transaction, the one that
// writes the closure; a room without a valid window reads nobody. A member
// marked absent on a block is not in the room for it; each member counts
// once, in ascending order.
func (q roomBlockStaffQueries) RoomBlockStaffIDs(ctx context.Context, roomID int64, from, until calendar.Date) ([]int64, error) {
	if roomID <= 0 || from.IsZero() || until.IsZero() || until.Before(from) {
		q.observe(internalports.Observation{Operation: "room_block_staff", Err: timetable.ErrInvalidGroupQuery})
		return nil, timetable.ErrInvalidGroupQuery
	}
	started := time.Now()
	rows, stats, err := q.store.ListRoomBlockStaff(ctx, roomID, from, until)
	q.observe(internalports.Observation{Operation: "room_block_staff", Duration: time.Since(started), Stats: stats, Err: err})
	if err != nil {
		return nil, err
	}
	staffIDs := make([]int64, 0, len(rows))
	for _, row := range rows {
		if !row.Absent {
			staffIDs = append(staffIDs, row.StaffID)
		}
	}
	slices.Sort(staffIDs)
	return slices.Compact(staffIDs), nil
}
