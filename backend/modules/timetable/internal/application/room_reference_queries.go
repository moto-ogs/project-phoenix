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

// RoomReferenceRecords are the store reads behind RoomReferenceQuery and
// RoomBlockStaffQuery.
type RoomReferenceRecords interface {
	CountRoomReferences(context.Context, int64, calendar.Date) (timetable.RoomReferences, domain.OperationStats, error)
	ListRoomBlockStaff(ctx context.Context, roomID int64, from, until calendar.Date) ([]timetable.RoomBlockStaffRow, domain.OperationStats, error)
}

// NewRoomReferenceQueries answers the Facilities room removal's question
// which Timetable rows still use a room (#6845). The same queries name the
// staff a closure of a room concerns (#8234, timetable.RoomBlockStaffOf).
func NewRoomReferenceQueries(store RoomReferenceRecords, observe func(internalports.Observation), today func() calendar.Date) timetable.RoomReferenceQuery {
	if today == nil {
		panic("timetable room reference queries: the school day clock is required")
	}
	return roomReferenceQueries{store: store, observe: observe, today: today}
}

type roomReferenceQueries struct {
	store   RoomReferenceRecords
	observe func(internalports.Observation)
	today   func() calendar.Date
}

func (q roomReferenceQueries) CountRoomReferences(ctx context.Context, roomID int64) (timetable.RoomReferences, error) {
	if roomID <= 0 {
		q.observe(internalports.Observation{Operation: "count_room_references", Err: timetable.ErrInvalidGroupQuery})
		return timetable.RoomReferences{}, timetable.ErrInvalidGroupQuery
	}
	started := time.Now()
	// The room removal asks inside its own tenant transaction; the count
	// joins it, so it sees the rows the removal's locks hold.
	result, stats, err := q.store.CountRoomReferences(ctx, roomID, q.today())
	q.observe(internalports.Observation{Operation: "count_room_references", Duration: time.Since(started), Stats: stats, Err: err})
	if err != nil {
		return timetable.RoomReferences{}, err
	}
	return result, nil
}

var _ timetable.RoomBlockStaffQuery = roomReferenceQueries{}

// RoomBlockStaffIDs reads in the caller's tenant transaction, the one that
// writes the closure (#8234); a room without a valid window reads nobody. A
// member marked absent on a block is not in the room for it; each member
// counts once, in ascending order.
func (q roomReferenceQueries) RoomBlockStaffIDs(ctx context.Context, roomID int64, from, until calendar.Date) ([]int64, error) {
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
