package studentpresence

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ChildAttendanceDay is one child's care day at one school (#4717): when it
// arrived and when it was picked up. It is the source of the daily
// attendance report Träger in Mecklenburg-Vorpommern hand to the state
// (§ 32 Absatz 1a KiföG M-V). StudentID lets the caller count a child once
// and set its presence before an absence; the report itself names no child.
//
// ArrivedAt is the first check-in of the day. LeftAt is the last check-out,
// set only when every attendance of the day is closed and the nightly
// cleanup did not close it (as in ArrivalPickupSlot): a forgotten check-out
// is no pickup at 23:59.
type ChildAttendanceDay struct {
	SchoolID  int64
	Date      calendar.Date
	StudentID int64
	ArrivedAt time.Time
	LeftAt    *time.Time
}

// DailyAttendance answers the children's care days of the schools between
// from and to, both included, ordered by school, day and arrival.
//
// The caller must run it in the administrative transaction; it reads only the
// given schools.
type DailyAttendance interface {
	DailyAttendanceByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]ChildAttendanceDay, error)
}
