package traegerview

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The comparison of the schools of a Träger (#4715, ADR 0245): for a window
// the Träger-Büro chooses, the same key figures for every chosen school side
// by side, with the average of those schools and their figure together. The
// figures derive from the series of the utilization (#4713, ADR 0241) and
// from the roster of School Membership; they are counts, never a child,
// so the read is not written to the access log (ADR 0084 section 7).
//
// The binding definitions, over the weekdays of the window as
// traegerview.Utilization defines them:
//
//   - places: the places of the school, the sum of the limits of its
//     offerings with a limit. Together: the sum.
//   - places_rate: the booked places of all days over places times days, a
//     share (1 = full). Together: the booked places of all schools over
//     their places times days. No figure without places.
//   - free_places: places minus the average booked places; below 0 when
//     more children are booked than the limits allow. Together: the sum.
//   - booked: the average booked children per day, each child once over all
//     offerings. Together: the sum.
//   - booked_change: the booked children of the last weekday minus those of
//     the first. No figure for a window of one weekday. Together: the sum.
//   - present: the average children with a check-in per day that has
//     check-ins; a day without data does not count. Together: the sum of the
//     schools' averages.
//   - present_peak: the most children with a check-in on one day. Together:
//     no figure, the peaks of the schools fall on different days.
//   - active_students: the actively managed children on the last day of the
//     window, by the rule of the key-date report and the occupancy (the
//     roster of School Membership). It is a live count, never moto's billing
//     figure, which only the operator sees (#7301). Together: the sum.
//
// Average is the mean over the chosen schools that have the figure. A
// school without a figure carries no value for that key, never 0.

// The keys of the compared figures, in the order the page offers them.
const (
	ComparisonPlaces         = "places"
	ComparisonPlacesRate     = "places_rate"
	ComparisonFreePlaces     = "free_places"
	ComparisonBooked         = "booked"
	ComparisonBookedChange   = "booked_change"
	ComparisonPresent        = "present"
	ComparisonPresentPeak    = "present_peak"
	ComparisonActiveStudents = "active_students"
)

// ComparisonKeys lists every figure of the comparison in its order.
var ComparisonKeys = []string{
	ComparisonPlaces, ComparisonPlacesRate, ComparisonFreePlaces, ComparisonBooked,
	ComparisonBookedChange, ComparisonPresent, ComparisonPresentPeak, ComparisonActiveStudents,
}

// ComparisonValues maps a figure key to its value; a key without a figure is
// missing.
type ComparisonValues map[string]float64

// ComparisonFilter selects the window From to To (both included, the rules
// of the utilization window) and optionally the schools to compare; none
// compares every school of the Träger. A school of another Träger is
// ErrSchoolOutsideTraeger.
type ComparisonFilter struct {
	From      calendar.Date
	To        calendar.Date
	SchoolIDs []int64
}

// ComparedSchool is one school with its figures.
type ComparedSchool struct {
	School
	Values ComparisonValues `json:"values"`
}

// SchoolComparison is the comparison of the chosen schools, ordered by
// name, over the Days weekdays of the window From to To, read at AsOf.
// AttendanceFrom is the latest first day with check-ins among the chosen
// schools that lies after From, nil when every school has check-ins from
// From on; the page names it, because present compares fewer days there.
type SchoolComparison struct {
	From           calendar.Date    `json:"from"`
	To             calendar.Date    `json:"to"`
	Days           int              `json:"days"`
	AsOf           time.Time        `json:"as_of"`
	AttendanceFrom *calendar.Date   `json:"attendance_from"`
	Schools        []ComparedSchool `json:"schools"`
	Average        ComparisonValues `json:"average"`
	Together       ComparisonValues `json:"together"`
}

// Reports are the reports of the Träger-Portal beside Overview, which holds
// the twelve methods a public facade may carry: the heatmap (#4714), the
// comparison of schools (#4715, ADR 0245) and the daily attendance report
// of Mecklenburg-Vorpommern (#4717, ADR 0247).
type Reports interface {
	ArrivalPickupReport
	SchoolComparisons
	DailyAttendanceReport
}

// SchoolComparisons answers the comparison of the schools of a Träger.
type SchoolComparisons interface {
	// SchoolComparison returns the comparison of the chosen schools of the
	// Träger over the window. An invalid window is
	// ErrInvalidUtilizationWindow, a school of another Träger
	// ErrSchoolOutsideTraeger.
	SchoolComparison(ctx context.Context, organizationID int64, filter ComparisonFilter) (SchoolComparison, error)
}
