package careplan

import (
	"context"

	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Telling the people of a class that its Stundenplan changed (#7142). The
// Stundenplan of a class in moto is when its lessons end: the weekly
// Unterrichtsschluss per weekday and a class-wide change on one day. Who the
// people of the class are and how they hear about it is the root's to bind:
// both come from owners built after Care Plan.

// The kinds of a change to the Stundenplan of a class.
const (
	// ClassTimetableWeekly: the weekly Unterrichtsschluss changed on
	// Weekdays; the change takes effect on Day, the first of them still
	// ahead.
	ClassTimetableWeekly = "weekly"
	// ClassTimetableDay: the class ends at ArrivalTime on Day.
	ClassTimetableDay = "day"
	// ClassTimetableDayRemoved: the change of Day is taken back; the weekly
	// time applies again.
	ClassTimetableDayRemoved = "day_removed"
)

// The push reach of a change, by its lead time (#7127): today or tomorrow
// push by default, 2 to 14 days ahead only for who asked for it, and later
// changes reach the feed only.
const (
	ClassTimetablePushSoon  = "soon"
	ClassTimetablePushAhead = "ahead"
	ClassTimetablePushNone  = "none"
)

// ClassTimetableNotice is one saved change to the Stundenplan of a class. It
// carries no reason: a reason is free text and may name people.
type ClassTimetableNotice struct {
	Kind        string
	SchoolClass string
	Day         calendar.Date
	// Weekdays are the changed weekdays (1 Monday to 5 Friday), ascending,
	// with their new time ("15:04"), empty when the time was cleared. Only
	// for ClassTimetableWeekly.
	Weekdays []ClassTimetableWeekday
	// ArrivalTime is the time the class ends on Day ("15:04"), for
	// ClassTimetableDay only.
	ArrivalTime string
	Push        string
}

// ClassTimetableWeekday is one changed weekday of the weekly
// Unterrichtsschluss.
type ClassTimetableWeekday struct {
	Weekday int
	Time    string
}

// ClassTimetableNotices tells the people of the class about a change to its
// Stundenplan, inside the transaction of the change. The person who made the
// change is the account of the request and hears nothing about it.
type ClassTimetableNotices interface {
	NotifyClassTimetableChanged(ctx context.Context, notice ClassTimetableNotice) error
}
