package traegerview

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The heatmap of arrival and pickup times (#4714): when the children of each
// school of a Träger arrive and are picked up, per weekday and half hour, so
// the Träger-Büro can plan its staff. It carries averages, never a child, so
// a read is not written to the access log (ADR 0084 section 7).
//
// The binding definitions:
//
//   - Arrival is the first check-in of a child on a day, pickup its last
//     check-out. A child counts once a day for each. A day with an open
//     attendance (on site or never checked out) has an arrival but no pickup.
//   - A slot is a half hour of the Berlin wall clock; a check-in at 07:44
//     counts in the slot from 07:30.
//   - Days are the days of the weekday in the period on which the school
//     recorded an attendance, so holidays, closing days and days whose
//     attendance the retention cleanup removed do not lower the average.
//   - The average of a slot is its arrivals (pickups) divided by the days of
//     its weekday at that school. All schools together add up the averages of
//     the schools: the children a Träger sees arrive on a typical Monday.
//   - Today never counts, because its pickups are not over: the period ends
//     yesterday at the latest.

// ArrivalPickupSlotMinutes is the length of a slot.
const ArrivalPickupSlotMinutes = 30

// ArrivalPickupMaxDays bounds the period of one heatmap.
const ArrivalPickupMaxDays = 366

// ErrInvalidArrivalPickupPeriod reports a period without both days, a
// reversed one, one over ArrivalPickupMaxDays, or one that starts today or
// later.
var ErrInvalidArrivalPickupPeriod = errors.New("traeger view: invalid period for arrival and pickup times")

// ArrivalPickupCell is one half hour of a weekday: the children who arrived
// and who were picked up in it on an average day.
type ArrivalPickupCell struct {
	StartMinute int     `json:"start_minute"`
	Arrivals    float64 `json:"arrivals"`
	Pickups     float64 `json:"pickups"`
}

// ArrivalPickupWeekday is one weekday of a heatmap. Days are the days the
// averages divide by; for all schools together the most days of one school.
// Slots run over the whole axis of the answer.
type ArrivalPickupWeekday struct {
	Weekday int                 `json:"weekday"`
	Days    int                 `json:"days"`
	Slots   []ArrivalPickupCell `json:"slots"`
}

// ArrivalPickupHeatmap is Monday to Friday, and Saturday and Sunday only
// where a school recorded an attendance on them.
type ArrivalPickupHeatmap struct {
	Weekdays []ArrivalPickupWeekday `json:"weekdays"`
}

// SchoolArrivalPickupTimes is the heatmap of one school of the Träger.
// FirstDay is the first day with an attendance in the period, nil without
// one; a later day than the period's start shows how far back its data
// reaches.
type SchoolArrivalPickupTimes struct {
	School
	ArrivalPickupHeatmap
	FirstDay *calendar.Date `json:"first_day"`
}

// ArrivalPickupTimes is the heatmap of every school of the Träger, ordered by
// name, and of all schools together, for the days From to To. FirstMinute
// and LastMinute are the first and the last slot of the axis every weekday
// shares: 07:00 to 17:30 at least, wider where a check-in or check-out lies
// outside.
type ArrivalPickupTimes struct {
	From        calendar.Date              `json:"from"`
	To          calendar.Date              `json:"to"`
	SlotMinutes int                        `json:"slot_minutes"`
	FirstMinute int                        `json:"first_minute"`
	LastMinute  int                        `json:"last_minute"`
	All         ArrivalPickupHeatmap       `json:"all"`
	Schools     []SchoolArrivalPickupTimes `json:"schools"`
}

// ArrivalPickupCount is one school's arrivals and pickups in one half hour of
// one ISO weekday (1 Monday to 7 Sunday), summed over the period.
type ArrivalPickupCount struct {
	SchoolID    int64
	Weekday     int
	StartMinute int
	Arrivals    int
	Pickups     int
}

// AttendanceDays are the days of one ISO weekday on which a school recorded
// an attendance in the period, and the first of them.
type AttendanceDays struct {
	SchoolID int64
	Weekday  int
	Days     int
	FirstDay calendar.Date
}

// ArrivalPickupCounts reads the arrivals and pickups of the schools between
// from and to (both included) at Student Presence. It joins the projection's
// administrative transaction and reads only the given schools.
type ArrivalPickupCounts interface {
	ArrivalPickupCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]ArrivalPickupCount, []AttendanceDays, error)
}
