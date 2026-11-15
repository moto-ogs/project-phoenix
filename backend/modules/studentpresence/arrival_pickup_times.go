package studentpresence

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ArrivalPickupSlot counts, for one school, one ISO weekday (1 Monday to 7
// Sunday) and one half hour of the Berlin wall clock, the children who
// arrived and who were picked up in it, summed over the days of a period
// (#4714). StartMinute is the start of the half hour in minutes after
// midnight.
//
// A child counts once a day for each: its arrival is the first check-in of
// the day, its pickup the last check-out, and only when every attendance of
// the day is closed, so a child still on site or never checked out has no
// pickup.
type ArrivalPickupSlot struct {
	SchoolID    int64
	Weekday     int
	StartMinute int
	Arrivals    int
	Pickups     int
}

// AttendanceWeekday counts the days of one ISO weekday in a period on which
// a school recorded at least one attendance, and names the first of them.
// The averages of a heatmap divide by these days.
type AttendanceWeekday struct {
	SchoolID int64
	Weekday  int
	Days     int
	FirstDay calendar.Date
}

// ArrivalPickupTimes answers the Träger's heatmap of arrival and pickup
// times (#4714) from the attendance of the schools between from and to, both
// included, in slots of slotMinutes on the Berlin wall clock. It names no
// child.
//
// The caller must run it in the administrative transaction; it reads only the
// given schools.
type ArrivalPickupTimes interface {
	ArrivalPickupTimesByTenant(ctx context.Context, schools []int64, from, to calendar.Date, slotMinutes int) ([]ArrivalPickupSlot, []AttendanceWeekday, error)
}

// TraegerPresence is what the Träger's views read of Student Presence: who is
// present right now (#5686) and when children arrive and leave (#4714).
type TraegerPresence interface {
	PresentStudents
	ArrivalPickupTimes
}
