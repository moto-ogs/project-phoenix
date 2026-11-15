package timetracking

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// DATEV writers (#1417 2b, final part). Both serialize the UNCHANGED
// MonthExportRow values — one line per staff member and configured Lohnart,
// value copied 1:1 from exactly one row field. No arithmetic happens here
// beyond rendering minutes as decimal hours.
//
// Format research (sources in the PR description):
//   - LODAS ASCII is self-describing: [Allgemein] header with Berater-/
//     MandantenNr, [Satzbeschreibung] declaring the record layout against
//     DATEV's table fields, then [Bewegungsdaten]. The Schnittstellenhandbuch
//     requires ANSI encoding and CR/LF line ends.
//   - Lohn und Gehalt ASCII has no header block: the tax consultant creates
//     the Importbeschreibung themselves in the ASCII-Importassistent. We write
//     the widespread 11-field Bewegungsdaten layout (Personalnummer;
//     Kalendertag;Ausfallschlüssel;Lohnartennummer;Stundenanzahl;Tagesanzahl;
//     Wert;Abw. Faktor;Abw. Lohnveränderung;Kostenstelle;Kostenträger) with
//     one header row the import description can skip.
//
// Encoding for both: Windows-1252 ("ANSI"), CR/LF, no BOM.

// ErrPayrollConfigIncomplete marks a DATEV export refused because the payroll
// configuration cannot produce a correct file (missing LODAS header, no
// configured Lohnart). Maintained on /payroll — HTTP 400 with the reason.
var ErrPayrollConfigIncomplete = errors.New("payroll configuration incomplete")

// DatevSkippedStaff is one staff member left out of the file.
type DatevSkippedStaff struct {
	LastName  string `json:"last_name"`
	FirstName string `json:"first_name"`
	Reason    string `json:"reason"`
}

// DatevExportReport is the visible companion of a DATEV file: the dialog
// shows it before the download, and a file is never produced without the
// caller being able to see it ("silently incomplete" must not exist).
type DatevExportReport struct {
	Format string `json:"format"`
	Year   int    `json:"year"`
	Month  int    `json:"month"`
	// LineCount is the number of Bewegungsdaten lines the file carries.
	LineCount int `json:"line_count"`
	// StaffExported / StaffSkipped partition the active staff.
	StaffExported int                 `json:"staff_exported"`
	StaffSkipped  []DatevSkippedStaff `json:"staff_skipped"`
	// UnconfiguredCategories lists Lohnart categories without a number —
	// they export no line (decided in #2008).
	UnconfiguredCategories []string `json:"unconfigured_categories"`
	// OpenMonth is true when at least one exported month row is not closed:
	// the values are current, not final.
	OpenMonth bool `json:"open_month"`
}

// datevCategoryValue picks the ONE MonthExportRow field a category exports.
// Returned minutes/days follow the category's configured unit; ok=false means
// no line (zero value). Payout and comp time are stored as negative balance
// deltas; the booked amount is the sign-inverted delta, so a reversal booking
// shows up negative instead of disappearing.
func datevCategoryValue(category PayrollExportCategory, row MonthExportRow) (minutes int, days float64, useDays bool, ok bool) {
	switch category.ID {
	case "regelarbeit":
		minutes = row.ActualMinutes
	case "plus_stunden":
		// An opening is a non-payroll go-live rebaseline. BalanceMinutes is
		// the current month's delta, so only exclude an opening booked in this
		// export month; CSV/XLSX expose it explicitly.
		payrollBalance := row.BalanceMinutes - row.OpeningMinutes
		if payrollBalance > 0 {
			minutes = payrollBalance
		}
	case "auszahlung":
		minutes = -row.PayoutMinutes
	case "freizeitausgleich":
		minutes = -row.CompTimeMinutes
	case "krank":
		minutes, days = row.CreditedSickMinutes, row.SickDays
	case "urlaub":
		minutes, days = row.CreditedVacationMinutes, row.VacationDays
	case "fortbildung":
		minutes, days = row.CreditedTrainingMinutes, row.TrainingDays
	default:
		return 0, 0, false, false
	}
	useDays = category.UnitRequired && category.Unit == "tage"
	if useDays {
		return 0, days, true, days != 0
	}
	return minutes, 0, false, minutes != 0
}

// buildDatevLines maps the export rows onto Bewegungsdaten lines and collects
// the report. Categories without a Lohnartnummer export no line; staff
// without a Personalnummer are reported, and exportDatev rejects the download.
func buildDatevLines(rows []MonthExportRow, status *PayrollExportConfiguration) ([]datevLine, *DatevExportReport) {
	report := &DatevExportReport{
		StaffSkipped:           []DatevSkippedStaff{},
		UnconfiguredCategories: []string{},
	}
	configured := configuredDatevCategories(status.Categories, report)

	var lines []datevLine
	exported := make(map[int64]bool)
	skipped := make(map[int64]bool)
	for _, row := range rows {
		if row.PersonnelNumber == "" {
			if !skipped[row.StaffID] {
				skipped[row.StaffID] = true
				report.StaffSkipped = append(report.StaffSkipped, DatevSkippedStaff{
					LastName:  row.LastName,
					FirstName: row.FirstName,
					Reason:    "keine Personalnummer",
				})
			}
			continue
		}
		exported[row.StaffID] = true
		if !row.IsClosed {
			report.OpenMonth = true
		}
		lines = appendDatevRowLines(lines, configured, row)
		lines = appendDatevWageTypeLines(lines, row)
	}
	report.UnconfiguredCategories = append(report.UnconfiguredCategories, unnumberedWageTypes(rows)...)
	report.LineCount = len(lines)
	report.StaffExported = len(exported)
	return lines, report
}

// configuredDatevCategories keeps the categories with a Lohnartnummer (and a
// unit where one is required) and reports the others as unconfigured.
func configuredDatevCategories(categories []PayrollExportCategory, report *DatevExportReport) []PayrollExportCategory {
	var configured []PayrollExportCategory
	for _, category := range categories {
		if !isDatevCategoryConfigured(category) {
			report.UnconfiguredCategories = append(report.UnconfiguredCategories, category.Label)
			continue
		}
		configured = append(configured, category)
	}
	return configured
}

func isDatevCategoryConfigured(category PayrollExportCategory) bool {
	return category.Number != "" && (!category.UnitRequired || category.Unit != "")
}

type datevWageTypeDefinition struct {
	id     int64
	name   string
	number string
}

func fixedDatevWageTypeNumbers(categories []PayrollExportCategory) map[string]string {
	used := make(map[string]string)
	for _, category := range categories {
		if !isDatevCategoryConfigured(category) {
			continue
		}
		// Fixed categories predate own wage types and may deliberately share a
		// number. Own wage types must not join that existing booking.
		if _, exists := used[category.Number]; !exists {
			used[category.Number] = category.Label
		}
	}
	return used
}

func definedDatevWageTypes(rows []MonthExportRow) []datevWageTypeDefinition {
	type definitionKey struct {
		id     int64
		number string
		unit   string
	}
	seen := make(map[definitionKey]bool)
	var definitions []datevWageTypeDefinition
	for _, row := range rows {
		if row.PayrollRules == nil {
			continue
		}
		for _, wageType := range row.PayrollRules.WageTypes {
			if wageType.Number == "" {
				continue
			}
			definition := datevWageTypeDefinition{id: wageType.ID, name: wageType.Name, number: wageType.Number}
			key := definitionKey{id: definition.id, number: definition.number, unit: wageType.Unit}
			if seen[key] {
				continue
			}
			seen[key] = true
			definitions = append(definitions, definition)
		}
	}
	return definitions
}

// validateDatevWageTypeNumbers keeps each own wage type distinct from the
// fixed categories and from every other own wage type the requested export
// can carry. Closed rows use their frozen definition, so this check belongs
// here rather than in the current-rule maintenance path.
func validateDatevWageTypeNumbers(rows []MonthExportRow, status *PayrollExportConfiguration) error {
	used := fixedDatevWageTypeNumbers(status.Categories)
	for _, wageType := range definedDatevWageTypes(rows) {
		if name, exists := used[wageType.number]; exists {
			return fmt.Errorf("%w: DATEV-Lohnartnummer %s ist sowohl für %s als auch für %s eingerichtet",
				ErrPayrollConfigIncomplete, wageType.number, name, wageType.name)
		}
		used[wageType.number] = wageType.name
	}
	return nil
}

// appendDatevRowLines appends one line per configured category with a value
// for the staff member's row.
func appendDatevRowLines(lines []datevLine, configured []PayrollExportCategory, row MonthExportRow) []datevLine {
	for _, category := range configured {
		minutes, days, useDays, ok := datevCategoryValue(category, row)
		if !ok {
			continue
		}
		line := datevLine{PersonnelNumber: row.PersonnelNumber, WageType: category.Number}
		if useDays {
			d := days
			line.Days = &d
		} else {
			m := minutes
			line.HoursMinutes = &m
		}
		lines = append(lines, line)
	}
	return lines
}

// datevLine is one Bewegungsdaten booking before serialization; the
// writers are shared with the Träger's file (#4712).
type datevLine = domain.DatevPayrollLine

func writeDatevLodas(lines []datevLine, status *PayrollExportConfiguration, year, month int) []byte {
	return domain.WriteDatevLodas(lines, status.Beraternummer, status.Mandantennummer, year, month)
}

func writeDatevLug(lines []datevLine) []byte {
	return domain.WriteDatevLug(lines)
}

// --- service entry points ---------------------------------------------------

// validateDatev enforces the format decisions: single month only (payroll is
// monthly; both formats book per Abrechnungszeitraum), and a payroll
// configuration that can produce a correct file. The open month stays allowed
// — the report says so.
func (s *staffTimeExportService) validateDatevRequest(req TimeExportRequest) error {
	if req.Format != ExportFormatDatevLodas && req.Format != ExportFormatDatevLug {
		return fmt.Errorf("%w: DATEV request requires format %s or %s",
			ErrTimeExportInvalid, ExportFormatDatevLodas, ExportFormatDatevLug)
	}
	if req.Month == 0 {
		return fmt.Errorf("%w: DATEV export requires a single month", ErrTimeExportInvalid)
	}
	if req.Granularity == ExportGranularityDay {
		return fmt.Errorf("%w: DATEV export is month-granular", ErrTimeExportInvalid)
	}
	return nil
}

func (s *staffTimeExportService) payrollStatusForDatev(ctx context.Context, format string) (*PayrollExportConfiguration, error) {
	if s.payrollStatus == nil {
		return nil, errors.New("datev export: payroll status service not configured")
	}
	status, err := s.payrollStatus.GetPayrollConfiguration(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load payroll status: %w", err)
	}
	if format == ExportFormatDatevLodas && !status.LodasHeaderComplete {
		return nil, fmt.Errorf("%w: Berater- und Mandantennummer fehlen", ErrPayrollConfigIncomplete)
	}
	return status, nil
}

// rowsHaveNumberedWageType reports whether the requested export period has an
// own wage type with a DATEV number. Closed rows carry the rules frozen at
// their close, so reading current rules here would validate a different file.
func rowsHaveNumberedWageType(rows []MonthExportRow) bool {
	for _, row := range rows {
		if row.PayrollRules == nil {
			continue
		}
		for _, wageType := range row.PayrollRules.WageTypes {
			if wageType.Number != "" {
				return true
			}
		}
	}
	return false
}

// buildDatev computes lines + report for both the download and the report
// endpoint — one code path, so the report can never disagree with the file.
func (s *staffTimeExportService) buildDatev(ctx context.Context, req TimeExportRequest) ([]datevLine, *DatevExportReport, *PayrollExportConfiguration, error) {
	if err := s.validateDatevRequest(req); err != nil {
		return nil, nil, nil, err
	}
	status, err := s.payrollStatusForDatev(ctx, req.Format)
	if err != nil {
		return nil, nil, nil, err
	}
	if status.ConfiguredCategories == 0 && s.payrollRules == nil {
		return nil, nil, nil, fmt.Errorf("%w: keine Lohnart konfiguriert", ErrPayrollConfigIncomplete)
	}
	rows, err := s.overview.GetMonthExportRows(ctx, req.Year, req.Month)
	if err != nil {
		return nil, nil, nil, err
	}
	if status.ConfiguredCategories == 0 && !rowsHaveNumberedWageType(rows) {
		return nil, nil, nil, fmt.Errorf("%w: keine Lohnart konfiguriert", ErrPayrollConfigIncomplete)
	}
	if err := validateDatevWageTypeNumbers(rows, status); err != nil {
		return nil, nil, nil, err
	}
	lines, report := buildDatevLines(rows, status)
	report.Format = req.Format
	report.Year = req.Year
	report.Month = req.Month
	return lines, report, status, nil
}

// DatevReport is the preflight the export dialog shows before the download.
// It runs the exact same build as the file and writes no audit row — nothing
// leaves the system.
func (s *staffTimeExportService) DatevReport(ctx context.Context, req TimeExportRequest) (*DatevExportReport, error) {
	if err := s.validate(&req); err != nil {
		return nil, err
	}
	_, report, _, err := s.buildDatev(ctx, req)
	return report, err
}

// exportDatev renders the requested DATEV file. Same audit contract as the
// other formats: no file without the audit row.
func (s *staffTimeExportService) exportDatev(ctx context.Context, req TimeExportRequest) (*ExportFile, *DatevExportReport, error) {
	lines, report, status, err := s.buildDatev(ctx, req)
	if err != nil {
		return nil, nil, err
	}
	if len(report.StaffSkipped) > 0 {
		return nil, report, fmt.Errorf("%w: %d Mitarbeitende ohne Personalnummer",
			ErrPayrollConfigIncomplete, len(report.StaffSkipped))
	}

	file := ExportFile{ContentType: "text/plain; charset=windows-1252"}
	if req.Format == ExportFormatDatevLodas {
		file.Data = writeDatevLodas(lines, status, req.Year, req.Month)
	} else {
		file.Data = writeDatevLug(lines)
	}
	file.Filename = fmt.Sprintf("%s_%04d-%02d.txt", req.Format, req.Year, req.Month)
	return &file, report, nil
}
