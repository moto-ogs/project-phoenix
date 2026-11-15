package traegerview

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The key-date report of a Träger (#4716, spec #4611 user stories 115 and
// 116, ADR 0246): the figures the Träger-Büro hands its Kommune and its
// Jugendamt for one key date, per school, per Sozialraum and in total, in the
// sections a report template of the Träger names. The report holds counts
// and the names of schools, Sozialräume and care forms, never a child or a
// staff member, so like the occupancy it is not written to the access log
// (ADR 0084 section 7).
//
// The binding definitions:
//
//   - Children are the actively managed children of the Stichtagszahl rule
//     (#2791) on the key date, the roster of the occupancy (#4676). The rule
//     reads the membership as it stands: status active and enrolled until
//     the key date at least. A care form counts, by the occupancy rule, the
//     children of that roster with a booking of the offering valid on the key
//     date; WithoutCareForm counts the others.
//   - Staff are the staff members the school counts on the key date: not
//     deleted and without an external caregiver record valid that day, the
//     StaffTotal of SchoolFigures. ChildrenPerStaff is Children over Staff,
//     nil without staff.
//   - Absences count over the absence window: from 1 August of the school
//     year that holds the key date (key date month August or later: that
//     year, else the year before), at most 365 days before the key date, to
//     the key date, at most yesterday, which is the last day that is over.
//     PresentDays are the children with an attendance (check-in) summed over
//     the weekdays of the window; SickDays and ExcusedDays the children with
//     a sick or an excused status day that stands for the day (active, or
//     archived at its end), one per child and day, sick before excused. All
//     three count only on days with a check-in at the school: the school was
//     open and still keeps that day's attendance, so holidays, closing days
//     and days before the kept attendance raise no absence. A child with a
//     check-in and a status on the same day counts in both. AbsenceRate is
//     SickDays plus ExcusedDays over PresentDays plus both, in percent; nil
//     without any such day. An empty window (a key date of today or later
//     before its school year has a day that is over) has no window and zeros.
//   - Demand: Places sum the capacities of the active care forms with a
//     capacity, BookedPlaces the children on those forms, FreePlaces is
//     Places minus BookedPlaces, never below 0. Booked are the children with
//     a care form (Children minus WithoutCareForm). Open are the children of
//     the online enrollment waiting for a decision, Waitlisted those on the
//     waitlist of a request that is not withdrawn. The enrollment keeps no
//     status history, so Open and Waitlisted are as of today, whatever the
//     key date. Demand is Booked plus Open plus Waitlisted.
//   - A Sozialraum sums the figures of its schools; ChildrenPerStaff and
//     AbsenceRate are computed from the sums. Its care forms add up children
//     and capacity per name of a care form; the capacity is nil when one of
//     them has none. The total does the same over every school.

// The sections of a key-date report in the order the report shows them.
const (
	ReportSectionChildren = "children"
	ReportSectionStaff    = "staff"
	ReportSectionAbsences = "absences"
	ReportSectionDemand   = "demand"
)

// ReportSections lists every section in order; the standard report without a
// template shows them all.
func ReportSections() []string {
	return []string{ReportSectionChildren, ReportSectionStaff, ReportSectionAbsences, ReportSectionDemand}
}

// UnmappedDistrict names the Sozialraum of the schools a template assigns
// none, once at least one school has one.
const UnmappedDistrict = "Ohne Sozialraum"

// KeyDateReportMaxDaysAhead bounds a key date in the future.
const KeyDateReportMaxDaysAhead = 366

// KeyDateReportEarliest is the earliest key date a report is drawn up for.
var KeyDateReportEarliest = calendar.NewDate(2000, time.January, 1)

var (
	// ErrInvalidKeyDate reports a missing key date, one before
	// KeyDateReportEarliest or one more than KeyDateReportMaxDaysAhead days
	// after today.
	ErrInvalidKeyDate = errors.New("traeger view: invalid key date")
	// ErrReportTemplateNotFound reports a template that is not one of the
	// Träger: an unknown ID and one of another Träger read the same.
	ErrReportTemplateNotFound = errors.New("traeger view: report template not found")
)

// ReportTemplate is a report template of the Träger as the report applies
// it: its sections in order and the Sozialraum of each school it assigns.
type ReportTemplate struct {
	ID        int64
	Name      string
	Sections  []string
	Districts map[int64]string
}

// ReportTemplateReads reads one report template of the Träger at
// Organisation & Tenancy. It joins the projection's administrative
// transaction and filters on the Träger; any other template is
// ErrReportTemplateNotFound.
type ReportTemplateReads interface {
	ReportTemplate(ctx context.Context, organizationID, templateID int64) (ReportTemplate, error)
}

// KeyDateAbsenceCounts counts, at Care Plan, the children of each school with a sick
// and with an excused status day, per weekday of the window (both days
// included); a child counts once a day, sick before excused. It joins the
// projection's administrative transaction and reads only the given schools.
type KeyDateAbsenceCounts interface {
	StatusDayCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (sick, excused map[int64]map[calendar.Date]int, err error)
}

// EnrollmentDemand counts, at Enrollment, the children of the online
// enrollment waiting for a decision and those on the waitlist, of requests
// that are not withdrawn, as of today. It joins the projection's
// administrative transaction and reads only the given schools.
type EnrollmentDemand interface {
	EnrollmentDemandByTenant(ctx context.Context, schools []int64) (open, waitlisted map[int64]int, err error)
}

// ReportPorts are the owners' reads behind the key-date report that the
// occupancy, the utilization and the school figures do not already bind.
type ReportPorts struct {
	Templates ReportTemplateReads
	Absences  KeyDateAbsenceCounts
	Demand    EnrollmentDemand
}

// KeyDateFigures are the figures of a school, a Sozialraum or the Träger on
// the key date. Every figure is filled; the report shows those of its
// sections.
type KeyDateFigures struct {
	Children         int      `json:"children"`
	WithoutCareForm  int      `json:"without_care_form"`
	Staff            int      `json:"staff"`
	ChildrenPerStaff *float64 `json:"children_per_staff"`
	PresentDays      int      `json:"present_days"`
	SickDays         int      `json:"sick_days"`
	ExcusedDays      int      `json:"excused_days"`
	AbsenceRate      *float64 `json:"absence_rate"`
	Places           int      `json:"places"`
	BookedPlaces     int      `json:"booked_places"`
	FreePlaces       int      `json:"free_places"`
	Booked           int      `json:"booked"`
	Open             int      `json:"open"`
	Waitlisted       int      `json:"waitlisted"`
	Demand           int      `json:"demand"`
}

// KeyDateCareForm is one care form with its children on the key date and
// its capacity, nil without one. Active is false for a form the school no
// longer offers; its places are no free places.
type KeyDateCareForm struct {
	Name     string `json:"name"`
	Children int    `json:"children"`
	Capacity *int   `json:"capacity"`
	Active   bool   `json:"active"`
}

// KeyDateSchool is one school of the Träger in the report. District is its
// Sozialraum in the template, nil without one. AttendanceFrom is the first
// day the school still keeps an attendance of, nil when it keeps none or the
// report shows no absences.
type KeyDateSchool struct {
	ID             int64             `json:"id"`
	Name           string            `json:"name"`
	City           string            `json:"city"`
	District       *string           `json:"district"`
	AttendanceFrom *calendar.Date    `json:"attendance_from"`
	Figures        KeyDateFigures    `json:"figures"`
	CareForms      []KeyDateCareForm `json:"care_forms"`
}

// KeyDateDistrict is one Sozialraum with the number of its schools and their
// sums.
type KeyDateDistrict struct {
	Name      string            `json:"name"`
	Unmapped  bool              `json:"unmapped"` // Distinguishes unassigned schools from a district with the fallback name.
	Schools   int               `json:"schools"`
	Figures   KeyDateFigures    `json:"figures"`
	CareForms []KeyDateCareForm `json:"care_forms"`
}

// KeyDateTotal is the sum over every school of the Träger.
type KeyDateTotal struct {
	Schools   int               `json:"schools"`
	Figures   KeyDateFigures    `json:"figures"`
	CareForms []KeyDateCareForm `json:"care_forms"`
}

// KeyDateReportTemplate names the template a report was drawn up with.
type KeyDateReportTemplate struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// ReportWindow is a window of days, both included.
type ReportWindow struct {
	From calendar.Date `json:"from"`
	To   calendar.Date `json:"to"`
}

// KeyDateReport is the report of every school of the Träger on KeyDate,
// read at AsOf. Template is nil for the standard report, which shows every
// section and no Sozialraum. AbsenceWindow is nil when the report shows no
// absences or the window holds no day that is over. Schools are ordered by
// name; Districts by name with UnmappedDistrict last, empty when the
// template assigns no school a Sozialraum.
type KeyDateReport struct {
	KeyDate       calendar.Date          `json:"key_date"`
	AsOf          time.Time              `json:"as_of"`
	Template      *KeyDateReportTemplate `json:"template"`
	Sections      []string               `json:"sections"`
	AbsenceWindow *ReportWindow          `json:"absence_window"`
	Schools       []KeyDateSchool        `json:"schools"`
	Districts     []KeyDateDistrict      `json:"districts"`
	Total         KeyDateTotal           `json:"total"`
}

// The formats a key-date report is exported in.
const (
	ReportFormatPDF  = "pdf"
	ReportFormatXLSX = "xlsx"
	ReportFormatCSV  = "csv"
)

// ErrUnsupportedReportFormat reports an export format other than the
// ReportFormat constants.
var ErrUnsupportedReportFormat = errors.New("traeger view: unsupported report format")

// ReportFile is an exported report.
type ReportFile struct {
	Data        []byte
	ContentType string
	Filename    string
}

// KeyDateReports draws up the key-date report of a Träger. It is a facade of
// its own beside Overview, which holds the projection's other reads.
type KeyDateReports interface {
	// KeyDateReport returns the report of every school of the Träger on the
	// key date in the sections of the template; templateID 0 is the
	// standard report.
	KeyDateReport(ctx context.Context, organizationID int64, keyDate calendar.Date, templateID int64) (KeyDateReport, error)
	// KeyDateReportExport returns the same report as a file of the format:
	// a row per school grouped by Sozialraum, a sum per Sozialraum, the total
	// and, with the children, the children per care form.
	KeyDateReportExport(ctx context.Context, organizationID int64, keyDate calendar.Date, templateID int64, format string) (ReportFile, error)
}
