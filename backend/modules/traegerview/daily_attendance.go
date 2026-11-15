package traegerview

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The daily attendance report (#4717): Träger in Mecklenburg-Vorpommern
// record the daily arrival and pickup times of the children in care and hand
// them to the state ministry (§ 32 Absatz 1a KiföG M-V, from 2027). The
// ministry's format follows in the Kindertagesförderungsauskunftsverordnung
// (KiföAVO M-V); until it is published the report uses the general mapping
// below, one row per child and day without name or ID.
//
// The binding definitions:
//
//   - Only schools whose federal state (operations.federal_state) is
//     Mecklenburg-Vorpommern take part. The other schools of the Träger are
//     counted, never shown.
//   - A child is present on a day with an attendance there. Its arrival is
//     the first check-in, its pickup the last check-out, as in the heatmap of
//     arrival and pickup times (#4714): a day still open or closed by the
//     nightly cleanup has no pickup and no length of stay.
//   - A child is absent with a status day that stands for the day: sick,
//     excused or on a class trip, one status a day (sick before excused before
//     class trip). Place before status: a present child counts as present
//     only.
//   - Days are Monday to Friday of the period, and Saturday and Sunday where a
//     school recorded a child on them.
//   - Today never counts, because its pickups are not over: the period ends
//     yesterday at the latest.

// FederalStateMecklenburgVorpommern is the federal state the report is for.
const FederalStateMecklenburgVorpommern = "DE-MV"

// DailyAttendanceMaxDays bounds the period of one report: a month.
const DailyAttendanceMaxDays = 31

// The access log entries of the report at each school it shows: the
// figures per day and the file.
const (
	ResourceTypeTraegerDailyAttendance       = "traeger_daily_attendance"
	ResourceTypeTraegerDailyAttendanceExport = "traeger_daily_attendance_export"
)

// The statuses of a DailyAttendanceRecord.
const (
	AttendancePresent   = "present"
	AttendanceSick      = "sick"
	AttendanceExcused   = "excused"
	AttendanceClassTrip = "class_trip"
)

// ErrInvalidDailyAttendancePeriod reports a period without both days, a
// reversed one, one over DailyAttendanceMaxDays, or one that starts today or
// later.
var ErrInvalidDailyAttendancePeriod = errors.New("traeger view: invalid period for the daily attendance report")

// DailyAttendanceFigures are the figures of one day, or of a whole period.
// Present, Sick, Excused and ClassTrip count child-days. WithoutPickup are
// the present child-days without a recorded pickup. FirstArrival and
// LastPickup are the earliest check-in and the latest pickup, nil without
// one. AverageMinutes and LongestMinutes are the length of stay of the
// child-days with a pickup, nil without one.
type DailyAttendanceFigures struct {
	Present        int        `json:"present"`
	Sick           int        `json:"sick"`
	Excused        int        `json:"excused"`
	ClassTrip      int        `json:"class_trip"`
	WithoutPickup  int        `json:"without_pickup"`
	FirstArrival   *time.Time `json:"first_arrival"`
	LastPickup     *time.Time `json:"last_pickup"`
	AverageMinutes *int       `json:"average_minutes"`
	LongestMinutes *int       `json:"longest_minutes"`
}

// DailyAttendanceDay is the figures of one day.
type DailyAttendanceDay struct {
	Date calendar.Date `json:"date"`
	DailyAttendanceFigures
}

// DailyAttendanceSummary is the figures of a whole period. DaysWithChildren
// are the days a child was present on; PresentPerDay is Present divided by
// them, with one decimal, 0 without such a day.
type DailyAttendanceSummary struct {
	DailyAttendanceFigures
	DaysWithChildren int     `json:"days_with_children"`
	PresentPerDay    float64 `json:"present_per_day"`
}

// SchoolDailyAttendance is one school in Mecklenburg-Vorpommern with its
// days and its summary.
type SchoolDailyAttendance struct {
	School
	Summary DailyAttendanceSummary `json:"summary"`
	Days    []DailyAttendanceDay   `json:"days"`
}

// DailyAttendance is the report of the Träger for the days From to To: its
// schools in Mecklenburg-Vorpommern ordered by name, all of them together
// per day and as a summary, and the number of its other schools, which the
// report leaves out.
type DailyAttendance struct {
	From         calendar.Date           `json:"from"`
	To           calendar.Date           `json:"to"`
	FederalState string                  `json:"federal_state"`
	OtherSchools int                     `json:"other_schools"`
	Summary      DailyAttendanceSummary  `json:"summary"`
	Days         []DailyAttendanceDay    `json:"days"`
	Schools      []SchoolDailyAttendance `json:"schools"`
}

// DailyAttendanceRecord is one child on one day at one school, without name
// or ID. Status is one of the Attendance constants; ArrivedAt, LeftAt and
// Minutes are set for a present child only, LeftAt and Minutes only with a
// pickup.
type DailyAttendanceRecord struct {
	SchoolID  int64
	Date      calendar.Date
	Status    string
	ArrivedAt *time.Time
	LeftAt    *time.Time
	Minutes   *int
}

// DailyAttendanceExport is the report's file: its schools ordered by name
// and their records by school, day, status and arrival.
type DailyAttendanceExport struct {
	From    calendar.Date
	To      calendar.Date
	Schools []School
	Records []DailyAttendanceRecord
}

// ChildDay is one child's care day at one school, at Student Presence.
// StudentID only counts the child once; it never leaves the projection.
type ChildDay struct {
	SchoolID  int64
	Date      calendar.Date
	StudentID int64
	ArrivedAt time.Time
	LeftAt    *time.Time
}

// AbsenceDay is one child's reported absence on one day, at Care Plan:
// Status is AttendanceSick, AttendanceExcused or AttendanceClassTrip.
type AbsenceDay struct {
	SchoolID  int64
	Date      calendar.Date
	StudentID int64
	Status    string
}

// DailyAttendancePorts are the reads behind the report. Days and Absences
// join the projection's administrative transaction and read only the given
// schools; States runs in its own units, so the projection calls it outside
// its administrative unit.
type DailyAttendancePorts struct {
	Days     ChildDays
	Absences AbsenceDays
	States   SchoolStates
}

// ChildDays reads the children's care days of the schools between from and
// to, both included, at Student Presence.
type ChildDays interface {
	ChildDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]ChildDay, error)
}

// AbsenceDays reads the children's reported absences of the schools between
// from and to, both included, at Care Plan.
type AbsenceDays interface {
	AbsenceDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]AbsenceDay, error)
}

// SchoolStates reads the federal state of each school of a Träger, keyed by
// school. A deactivated, deleted or unknown Träger is ErrTraegerUnavailable.
type SchoolStates interface {
	TraegerSchoolStates(ctx context.Context, organizationID int64) (map[int64]string, error)
}

// DailyAttendanceReport answers the daily attendance report of the
// Träger-Portal (#4717). It stands apart from Overview so that each facade
// stays small (#2580).
type DailyAttendanceReport interface {
	// DailyAttendance returns the figures of the Träger's schools in
	// Mecklenburg-Vorpommern between from and to. They name no child, but
	// on a day with one child the first arrival and the longest stay are
	// that child's times, so the access log of each school with children
	// records the read with the viewer's account. An invalid period is
	// ErrInvalidDailyAttendancePeriod.
	DailyAttendance(ctx context.Context, viewer Viewer, from, to calendar.Date) (DailyAttendance, error)
	// DailyAttendanceExport returns one record per child and day. A record
	// names no child, yet the rows of a small school are close to its
	// children, so the access log of each school with rows records the
	// export with the viewer's account.
	DailyAttendanceExport(ctx context.Context, viewer Viewer, from, to calendar.Date) (DailyAttendanceExport, error)
	// FederalStates returns the federal states of the Träger's schools,
	// each once and sorted, so the portal offers the report only where it
	// applies.
	FederalStates(ctx context.Context, organizationID int64) ([]string, error)
}
