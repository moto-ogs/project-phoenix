package workforce

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The exports of the Personalverwaltung over all schools (#4712, ADR 0089
// section 11, ADR 0250): the DATEV payroll file of the Träger, one file over
// every Arbeitsvertrag the Träger closes, and the time export for a Träger
// with its own time system, one CSV row per person, day and Einsatzort. Each
// school computes its month and its days in its own tenant transaction and
// writes the access log entry there before anything leaves it.

// Access log views of the exports.
const (
	TraegerStaffViewPayrollReport = "staff_payroll_report"
	TraegerStaffViewPayrollExport = "staff_payroll_export"
	TraegerStaffViewTimeReport    = "staff_time_report"
	TraegerStaffViewTimeExport    = "staff_time_export"
)

// The two DATEV formats of the payroll file, the values the school's export
// uses too.
const (
	TraegerPayrollFormatLodas = "datev_lodas"
	TraegerPayrollFormatLug   = "datev_lug"
)

// The categories of the payroll file, the same the school's file books
// (#1417 2b). Each has a Lohnart per kind of contract.
const (
	TraegerPayrollRegular  = "regelarbeit"
	TraegerPayrollPlus     = "plus_stunden"
	TraegerPayrollPayout   = "auszahlung"
	TraegerPayrollCompTime = "freizeitausgleich"
	TraegerPayrollSick     = "krank"
	TraegerPayrollVacation = "urlaub"
	TraegerPayrollTraining = "fortbildung"
)

// TraegerPayrollCategories lists the categories in file order.
var TraegerPayrollCategories = []string{
	TraegerPayrollRegular, TraegerPayrollPlus, TraegerPayrollPayout, TraegerPayrollCompTime,
	TraegerPayrollSick, TraegerPayrollVacation, TraegerPayrollTraining,
}

// TraegerPayrollDayCategories are the categories DATEV may expect in days;
// their unit is a Träger value.
var TraegerPayrollDayCategories = []string{TraegerPayrollSick, TraegerPayrollVacation, TraegerPayrollTraining}

// The units of a day category.
const (
	TraegerPayrollUnitHours = "stunden"
	TraegerPayrollUnitDays  = "tage"
)

var (
	// ErrTraegerExportInvalid refuses a month outside 2000..2100, a month
	// in the future or an unknown format.
	ErrTraegerExportInvalid = errors.New("workforce: the export request is invalid")
	// ErrTraegerPayrollNotReady refuses the payroll file while the report
	// names a reason: a person without Personalnummer, a LODAS file without
	// Berater- and Mandantennummer, or no Lohnart at all.
	ErrTraegerPayrollNotReady = errors.New("workforce: the payroll file cannot be made yet")
)

// TraegerPayrollSettings are the Träger values of the payroll file (ADR 0089
// section 11): the DATEV client and the Lohnart per category and kind of
// contract. A school's own payroll settings do not apply.
type TraegerPayrollSettings struct {
	ConsultantNumber string
	ClientNumber     string
	// WageTypes maps a category and a kind to its Lohnart, "" for none.
	WageTypes map[string]map[string]string
	// Units maps a day category to TraegerPayrollUnitHours or
	// TraegerPayrollUnitDays, "" when not chosen.
	Units map[string]string
}

// TraegerPayrollSettingsReader reads the payroll values of a Träger.
type TraegerPayrollSettingsReader interface {
	TraegerPayrollSettings(ctx context.Context, organizationID int64) (TraegerPayrollSettings, error)
}

// TraegerPayrollMonth is the month of one employment as its school's
// Monatskarte computes it, in the values the payroll file books.
type TraegerPayrollMonth struct {
	StaffID int64
	// RegularMinutes is the Ist, PlusMinutes the positive balance of the
	// month without an opening booking.
	RegularMinutes  int
	PlusMinutes     int
	PayoutMinutes   int
	CompTimeMinutes int
	SickMinutes     int
	VacationMinutes int
	TrainingMinutes int
	SickDays        float64
	VacationDays    float64
	TrainingDays    float64
	Closed          bool
}

// TraegerTimeDay is one day of one employment at its school: the first
// start, the last end, the breaks, the Ist and an absence with its kind.
type TraegerTimeDay struct {
	StaffID      int64
	Date         calendar.Date
	Start        string
	End          string
	BreakMinutes int
	// ActualMinutes is the credited net time of the day's blocks.
	ActualMinutes int
	// AbsenceKind is the base kind (urlaub, krank, …), AbsenceLabel the name
	// the school shows; both empty on a day without absence.
	AbsenceKind  string
	AbsenceLabel string
}

// TraegerTimeRequest asks one school for the time export: StaffIDs are the
// employments the report names, DaysFor those whose days the file carries.
type TraegerTimeRequest struct {
	StaffIDs []int64
	DaysFor  []int64
	From, To calendar.Date
}

// TraegerTimeSchool answers it: Kept are the named employments the export
// keeps, without external caregivers (#3823), offboarded ones included; Days
// are the days of the kept ones in DaysFor.
type TraegerTimeSchool struct {
	Kept []int64
	Days []TraegerTimeDay
}

// TraegerStaffExportSchool reads the months and days of the school of the
// caller's tenant transaction for the Träger's exports.
type TraegerStaffExportSchool interface {
	TraegerPayrollMonths(ctx context.Context, staffIDs []int64, year, month int) ([]TraegerPayrollMonth, error)
	TraegerTimeDays(ctx context.Context, request TraegerTimeRequest) (TraegerTimeSchool, error)
}

// TraegerExportMonth names the month of an export and, for the payroll
// file, its format.
type TraegerExportMonth struct {
	Year   int
	Month  int
	Format string
}

// TraegerExportPerson is a person the export names: one left out for a
// missing Personalnummer.
type TraegerExportPerson struct {
	RecordID  int64  `json:"record_id,string"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// TraegerPayrollKindCount counts the contracts and lines of one kind.
type TraegerPayrollKindCount struct {
	Kind      string `json:"kind"`
	Contracts int    `json:"contracts"`
	Lines     int    `json:"lines"`
}

// TraegerPayrollGap is a category of a kind the file has a value for but no
// Lohnart: the file leaves the value out.
type TraegerPayrollGap struct {
	Category string `json:"category"`
	Kind     string `json:"kind"`
}

// TraegerPayrollReport is the check the page shows before the download. The
// file and the report come from one computation, so they never disagree.
type TraegerPayrollReport struct {
	Year      int                       `json:"year"`
	Month     int                       `json:"month"`
	Format    string                    `json:"format"`
	Contracts int                       `json:"contracts"`
	People    int                       `json:"people"`
	Schools   int                       `json:"schools"`
	LineCount int                       `json:"line_count"`
	Kinds     []TraegerPayrollKindCount `json:"kinds"`
	// WithoutNumber are the people without Personalnummer; the file waits
	// for them (ADR 0089 section 4).
	WithoutNumber []TraegerExportPerson `json:"without_number"`
	// Unconfigured are values without a Lohnart; the file leaves them out.
	Unconfigured []TraegerPayrollGap `json:"unconfigured"`
	// MissingClient is true for a LODAS file without Berater- or
	// Mandantennummer.
	MissingClient bool `json:"missing_client"`
	// NoWageType is true when no Lohnart is set at all.
	NoWageType bool `json:"no_wage_type"`
	// OpenSchools names the schools whose month is not closed for every
	// person: the values may still change.
	OpenSchools []string `json:"open_schools"`
	// ContractChanges are the people whose contract changes within the
	// month at one school; the later contract books the whole month there.
	ContractChanges []TraegerExportPerson `json:"contract_changes"`
	Ready           bool                  `json:"ready"`
}

// TraegerTimeReport is the check of the time export.
type TraegerTimeReport struct {
	Year    int `json:"year"`
	Month   int `json:"month"`
	People  int `json:"people"`
	Schools int `json:"schools"`
	Rows    int `json:"rows"`
	// WithoutNumber are the people the file leaves out: a row needs the
	// Personalnummer the other system knows.
	WithoutNumber []TraegerExportPerson `json:"without_number"`
}

// TraegerExportFile is a rendered download.
type TraegerExportFile struct {
	Data        []byte
	Filename    string
	ContentType string
}

// TraegerPayrollNotReadyError carries the report of a refused file.
type TraegerPayrollNotReadyError struct {
	Report TraegerPayrollReport
}

func (e *TraegerPayrollNotReadyError) Error() string { return ErrTraegerPayrollNotReady.Error() }

func (e *TraegerPayrollNotReadyError) Unwrap() error { return ErrTraegerPayrollNotReady }

// TraegerStaffExports serves the two exports of the Personalverwaltung. Each
// report and each file writes an access log entry in every school it reads;
// a failed entry leaves no report and no file.
type TraegerStaffExports interface {
	PayrollReport(ctx context.Context, actor TraegerStaffActor, month TraegerExportMonth) (TraegerPayrollReport, error)
	PayrollFile(ctx context.Context, actor TraegerStaffActor, month TraegerExportMonth) (TraegerExportFile, error)
	TimeReport(ctx context.Context, actor TraegerStaffActor, month TraegerExportMonth) (TraegerTimeReport, error)
	TimeFile(ctx context.Context, actor TraegerStaffActor, month TraegerExportMonth) (TraegerExportFile, error)
}
