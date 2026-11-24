package workforce

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
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

// The forms of the payroll file (#8041, ADR 0320): one file for the whole
// Träger, whose lines of another employer carry its Kostenstelle, or one
// file per employer with its own DATEV client.
const (
	TraegerPayrollFormTraeger     = "traeger"
	TraegerPayrollFormArbeitgeber = "arbeitgeber"
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
	// ErrTraegerPayrollEmployerInvalid refuses a payroll value of an
	// employer; TraegerPayrollEmployerError names the field.
	ErrTraegerPayrollEmployerInvalid = errors.New("workforce: the payroll values of the employer are invalid")
)

// TraegerPayrollEmployerError names the refused field of an employer's
// payroll values.
type TraegerPayrollEmployerError struct {
	Field string
}

func (e *TraegerPayrollEmployerError) Error() string {
	return ErrTraegerPayrollEmployerInvalid.Error() + ": " + e.Field
}

func (e *TraegerPayrollEmployerError) Unwrap() error { return ErrTraegerPayrollEmployerInvalid }

// TraegerPayrollSettings are the Träger values of the payroll file (ADR 0089
// section 11): the DATEV client and the Lohnart per category and kind of
// contract. A school's own payroll settings do not apply.
type TraegerPayrollSettings struct {
	// Form is TraegerPayrollFormTraeger or TraegerPayrollFormArbeitgeber.
	Form             string
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
	// File names one file of the form per employer (TraegerPayrollFile.Key);
	// empty for the one file of the Träger.
	File string
}

// TraegerPayrollEmployerValues are the payroll values of a body that
// employs the staff of a school in place of the Träger (#8041, ADR 0320):
// the DATEV client of its own file and the Kostenstelle of its lines in the
// one file of the Träger. Version is the read state a save sends back (ADR
// 0311); readstate.Absent while nothing is stored.
type TraegerPayrollEmployerValues struct {
	SchoolID         ident.ID `json:"school_id"`
	SchoolName       string   `json:"school_name"`
	Body             string   `json:"body"`
	Name             string   `json:"name"`
	ConsultantNumber string   `json:"consultant_number"`
	ClientNumber     string   `json:"client_number"`
	CostCenter       string   `json:"cost_center"`
	Version          string   `json:"version"`
}

// TraegerPayrollEmployerList lists, in school order, every school whose
// staff a Schulträger or a Gemeinde employs, with its payroll values.
type TraegerPayrollEmployerList struct {
	Employers []TraegerPayrollEmployerValues `json:"employers"`
}

// TraegerPayrollEmployerInput are the payroll values the Personalverwaltung
// saves for the body of a school; every value may be empty.
type TraegerPayrollEmployerInput struct {
	Body             string
	ConsultantNumber string
	ClientNumber     string
	CostCenter       string
	ExpectedVersion  string
}

// TraegerExportPerson is a person the export names: one left out for a
// missing Personalnummer.
type TraegerExportPerson struct {
	RecordID  ident.ID `json:"record_id"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
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

// TraegerPayrollFileEmployer is an employer whose lines a file carries:
// the Träger (Body "traeger", no name) or a Schulträger or a Gemeinde.
type TraegerPayrollFileEmployer struct {
	Body string `json:"body"`
	Name string `json:"name"`
}

// TraegerPayrollDuplicate is a personnel number two people would share in
// one file: DATEV would book the hours of both to one person.
type TraegerPayrollDuplicate struct {
	Number string                `json:"number"`
	People []TraegerExportPerson `json:"people"`
}

// TraegerPayrollSplitNumber is a person a file would book under two
// personnel numbers: DATEV would see two people.
type TraegerPayrollSplitNumber struct {
	Person  TraegerExportPerson `json:"person"`
	Numbers []string            `json:"numbers"`
}

// TraegerPayrollFile is one file of the month: the one file of the Träger,
// or in the form per employer one file per DATEV client. Key names it for
// the download.
type TraegerPayrollFile struct {
	Key              string                       `json:"key"`
	Employers        []TraegerPayrollFileEmployer `json:"employers"`
	Schools          []string                     `json:"schools"`
	ConsultantNumber string                       `json:"consultant_number"`
	ClientNumber     string                       `json:"client_number"`
	People           int                          `json:"people"`
	LineCount        int                          `json:"line_count"`
	// MissingClient is true when the file lacks its Berater- or
	// Mandantennummer: for LODAS always, per employer for every format.
	MissingClient bool `json:"missing_client"`
	// WithoutNumber are the people of this file without personnel number.
	WithoutNumber []TraegerExportPerson     `json:"without_number"`
	Duplicates    []TraegerPayrollDuplicate `json:"duplicates"`
	// SplitNumbers are the people with two numbers in this file: their
	// number with the employer differs between its Einsatzorte.
	SplitNumbers []TraegerPayrollSplitNumber `json:"split_numbers"`
	Ready        bool                        `json:"ready"`
}

// TraegerPayrollEmployerCheck is a body that employs staff with values in
// the month, and what its payroll values still lack.
type TraegerPayrollEmployerCheck struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	Body       string   `json:"body"`
	Name       string   `json:"name"`
	// MissingClient: the form per employer needs its Berater- and
	// Mandantennummer. MissingCostCenter: the one file needs its
	// Kostenstelle.
	MissingClient     bool `json:"missing_client"`
	MissingCostCenter bool `json:"missing_cost_center"`
}

// TraegerPayrollReport is the check the page shows before the download. The
// file and the report come from one computation, so they never disagree.
type TraegerPayrollReport struct {
	Year   int    `json:"year"`
	Month  int    `json:"month"`
	Format string `json:"format"`
	// Form is the form of the file the Träger chose (ADR 0320).
	Form      string                    `json:"form"`
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
	// Files are the files of the month, one in the form of the Träger.
	Files []TraegerPayrollFile `json:"files"`
	// Employers are the bodies besides the Träger with values in the month.
	Employers []TraegerPayrollEmployerCheck `json:"employers"`
	// InSeveralFiles are the people in more than one file of the form per
	// employer: the Lohnbüro checks their number with each employer.
	InSeveralFiles []TraegerExportPerson `json:"in_several_files"`
	// Ready is true when every file can be made.
	Ready bool `json:"ready"`
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
	// PayrollEmployers lists the bodies that employ staff of a school with
	// their payroll values (#8041, ADR 0320); it reads no person.
	PayrollEmployers(ctx context.Context, actor TraegerStaffActor) (TraegerPayrollEmployerList, error)
	// SavePayrollEmployer stores the payroll values of the body that employs
	// the staff of schoolID. A body that does not employ there is
	// ErrTraegerStaffEmployerChanged, values changed since
	// input.ExpectedVersion readstate.ErrChanged.
	SavePayrollEmployer(ctx context.Context, actor TraegerStaffActor, schoolID int64, input TraegerPayrollEmployerInput) (TraegerPayrollEmployerValues, error)
}
