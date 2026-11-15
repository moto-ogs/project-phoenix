package facilities

import "context"

// TraegerRoom is one room of a school with its name and its limit.
type TraegerRoom struct {
	ID       int64
	Name     string
	Capacity *int
}

// TraegerRooms answers the Träger's utilization over time (#4713, ADR
// 0241): the rooms of each school, also archived ones, ordered by name, so
// the series of a past room keeps its name. System rooms are included; the
// caller lists only rooms with a visit. The map is keyed by school.
//
// The caller must run it in the administrative transaction; it reads only the
// given schools.
type TraegerRooms interface {
	RoomsByTenant(ctx context.Context, schools []int64) (map[int64][]TraegerRoom, error)
}
