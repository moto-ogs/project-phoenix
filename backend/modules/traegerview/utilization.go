package traegerview

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The utilization of the schools of a Träger over time (#4713, ADR 0241): for
// a window the Träger-Büro chooses, one value per weekday for every school,
// every care offering and every room, so it can see how full its places were
// and plan. The series carry counts and the names of offerings and rooms,
// never a child; the children of one school by name are a separate read
// behind its own right (UtilizationChildren).
//
// The binding definitions:
//
//   - Days are the weekdays (Monday to Friday) of the window, the days of
//     the Statistik report (#2606). Public holidays and closing days stay
//     in; a day without any check-in shows no attendance (nil), not 0.
//   - An offering is a care offering of the school that counts as care
//     (counts_as_care) and holds a booking in the window, or, in a window
//     that reaches today, is active and runs today, as on the occupancy of
//     today (#4676, #5977). A past window lists no offering it had no
//     booking in.
//   - Booked counts, per offering and day, the children of the online
//     enrollment whose booking is valid that day, the rule of the occupancy:
//     valid_from inclusive, valid_until exclusive. Only a booking of a child
//     the school took on counts (an approved enrollment child with a
//     student, at Enrollment); a child counts once per offering.
//   - A school's Booked counts each such child once over all its offerings.
//     Places sums the limits of its offerings with a limit, BookedPlaces the
//     booked children of those offerings; BookedPlaces over Places is the
//     utilization of its places.
//   - Present counts the children with an attendance of the day at the
//     school (check-in), the present days of the Statistik report. It is
//     nil before AttendanceFrom, the first day the school still keeps an
//     attendance of (gdpr.attendance_retention_days), on a day without any
//     attendance and today, which is not over yet.
//   - A room lists, per day, the children with a visit in it and the most
//     children at the same time (Peak), counted from the visits of the
//     children with an accepted privacy consent within its retention, like
//     the room utilization of the Statistik report. Both are nil before
//     RoomDataFrom, the first day with such a visit, on a day without any
//     visit at the school and today. A school with the attendance log
//     switched off keeps only today's visits and so shows no room, as its
//     own Statistik report does. Only rooms with a visit in the window are
//     listed.

// UtilizationMaxDays bounds one window: a school year plus a day, like the
// Statistik report.
const UtilizationMaxDays = 366

// ErrInvalidUtilizationWindow reports a missing or reversed window, one
// that ends in the future or one longer than UtilizationMaxDays.
var ErrInvalidUtilizationWindow = errors.New("traeger view: invalid utilization window")

// UtilizationOffering is one care offering of a school with its booked
// children per day of the window.
type UtilizationOffering struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Capacity *int   `json:"capacity"`
	Active   bool   `json:"active"`
	Booked   []int  `json:"booked"`
}

// UtilizationRoom is one room of a school with its children and its peak per
// day of the window.
type UtilizationRoom struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Capacity *int   `json:"capacity"`
	Children []*int `json:"children"`
	Peak     []*int `json:"peak"`
}

// SchoolUtilization is the utilization of one school of the Träger. Every
// series has one value per day of Utilization.Days. Offerings and Rooms are
// ordered by name.
type SchoolUtilization struct {
	School
	Places         int                   `json:"places"`
	Booked         []int                 `json:"booked"`
	BookedPlaces   []int                 `json:"booked_places"`
	Present        []*int                `json:"present"`
	AttendanceFrom *calendar.Date        `json:"attendance_from"`
	RoomDataFrom   *calendar.Date        `json:"room_data_from"`
	Offerings      []UtilizationOffering `json:"offerings"`
	Rooms          []UtilizationRoom     `json:"rooms"`
}

// Utilization is the utilization of every school of the Träger, ordered by
// name, over the weekdays Days of the window From to To, read at AsOf.
type Utilization struct {
	From    calendar.Date       `json:"from"`
	To      calendar.Date       `json:"to"`
	Days    []calendar.Date     `json:"days"`
	AsOf    time.Time           `json:"as_of"`
	Schools []SchoolUtilization `json:"schools"`
}

// BookingInterval is one booking of a request child: valid from ValidFrom
// (inclusive, nil = always) to ValidUntil (exclusive, nil = open).
type BookingInterval struct {
	RequestChildID int64
	ValidFrom      *calendar.Date
	ValidUntil     *calendar.Date
}

// OfferingBookingIntervals is one care offering that counts as care with
// its bookings that overlap the window.
type OfferingBookingIntervals struct {
	ID       int64
	Name     string
	Capacity *int
	Active   bool
	Bookings []BookingInterval
}

// CareBookingIntervals reads, at Care Plan, the care offerings of the schools
// that count as care and hold a booking overlapping the window or are active
// and belong to one of the running phases, ordered by name, with those
// bookings. It joins the projection's administrative transaction and reads
// only the given schools.
type CareBookingIntervals interface {
	CareOfferingIntervalsByTenant(ctx context.Context, schools []int64, from, to calendar.Date, runningPhases []int64) (map[int64][]OfferingBookingIntervals, error)
}

// DailyCounts are the counts of one school by day and the first day the
// school keeps data of; From is nil when it keeps none.
type DailyCounts struct {
	From   *calendar.Date
	Counts map[calendar.Date]int
}

// RoomVisitDay is one room on one day: the children with a visit and the
// most children at the same time.
type RoomVisitDay struct {
	RoomID   int64
	Day      calendar.Date
	Children int
	Peak     int
}

// SchoolRoomVisits are the room days of one school in the window and the
// first day the school keeps a counted visit of; From is nil without one.
type SchoolRoomVisits struct {
	From *calendar.Date
	Days []RoomVisitDay
}

// PresenceSeries reads, at Student Presence, the children with an attendance
// per school and day and the room days of the schools in the window. It
// joins the projection's administrative transaction and reads only the given
// schools.
type PresenceSeries interface {
	AttendanceCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]DailyCounts, error)
	RoomVisitDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]SchoolRoomVisits, error)
}

// NamedRoom is a room of a school with its limit.
type NamedRoom struct {
	ID       int64
	Name     string
	Capacity *int
}

// RoomNames reads, at Facilities, the rooms of the schools, also archived
// ones, ordered by name. It joins the projection's administrative
// transaction and reads only the given schools.
type RoomNames interface {
	RoomsByTenant(ctx context.Context, schools []int64) (map[int64][]NamedRoom, error)
}

// UtilizationPorts are the owners' reads behind the utilization. Children
// is the Enrollment read of the occupancy: the student of each approved
// request child and the running phases.
type UtilizationPorts struct {
	Bookings CareBookingIntervals
	Children BookedChildren
	Presence PresenceSeries
	Rooms    RoomNames
	// Attendance is the per-child read of one school behind
	// UtilizationChildren.
	Attendance SchoolChildAttendance
}

// ChildAttendance is one child of a school over the window, the row of the
// Statistik report: its care days (weekdays it was enrolled on, without
// public holidays, closing days and holidays), the days it was present and
// the reasons of the others. AttendanceRate is present over care days in
// percent, nil without a care day.
type ChildAttendance struct {
	StudentID       int64    `json:"student_id"`
	FirstName       string   `json:"first_name"`
	LastName        string   `json:"last_name"`
	SchoolClass     string   `json:"school_class"`
	GroupName       string   `json:"group_name"`
	CareDays        int      `json:"care_days"`
	PresentDays     int      `json:"present_days"`
	SickDays        int      `json:"sick_days"`
	ExcusedDays     int      `json:"excused_days"`
	UnexplainedDays int      `json:"unexplained_days"`
	AttendanceRate  *float64 `json:"attendance_rate"`
}

// SchoolChildAttendance reads the children of one school over the window
// from the Statistik report of Student Presence, in that school's tenant
// transaction. The report writes the read with the account of the
// Träger-Büro to the school's access log.
type SchoolChildAttendance interface {
	ChildAttendance(ctx context.Context, schoolID, accountID int64, from, to calendar.Date) ([]ChildAttendance, error)
}

// UtilizationChildren are the children of one school of the Träger by name
// over the window, ordered by last and first name.
type UtilizationChildren struct {
	School   School            `json:"school"`
	From     calendar.Date     `json:"from"`
	To       calendar.Date     `json:"to"`
	Children []ChildAttendance `json:"children"`
}
