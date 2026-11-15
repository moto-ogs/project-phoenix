package studentpresence

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SchoolAttendanceCounts are the children with an attendance per day of one
// school and the first day up to the window's end the school still keeps an
// attendance of; FirstDay is nil when it keeps none.
type SchoolAttendanceCounts struct {
	FirstDay *calendar.Date
	Children map[calendar.Date]int
}

// RoomDay is one room of a school on one day: the children with a counted
// visit and the most of them at the same time.
type RoomDay struct {
	RoomID   int64
	Day      calendar.Date
	Children int
	Peak     int
}

// SchoolRoomDays are the room days of one school in a window and the first
// day up to the window's end with a counted visit; FirstDay is nil without
// one.
type SchoolRoomDays struct {
	FirstDay *calendar.Date
	Days     []RoomDay
}

// PresenceSeries answers the Träger's utilization over time (#4713, ADR
// 0241) per school and day of the window from to to (both inclusive):
//
//   - the children with an attendance (check-in), once per child and day,
//     the present days of the Statistik report;
//   - per room the children with a visit and the peak, counted like the room
//     utilization of the Statistik report: only visits of children with an
//     accepted privacy consent within its retention count, a visit belongs to
//     the Berlin day it began on and ends at that day's end at the latest.
//
// A school without data is missing from the map. The caller must run it in
// the administrative transaction; it reads only the given schools.
type PresenceSeries interface {
	AttendanceCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]SchoolAttendanceCounts, error)
	RoomDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]SchoolRoomDays, error)
}
