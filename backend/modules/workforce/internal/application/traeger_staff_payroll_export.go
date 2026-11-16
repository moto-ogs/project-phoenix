package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The DATEV payroll file of the Träger (#4712, ADR 0089 section 11,
// ADR 0250): one file over every Arbeitsvertrag the Träger closes in the
// month. Each school computes the month of its employments in its own tenant
// transaction and writes the access log entry before the values leave it.
// The Träger sums a contract over its Einsatzorte and books each category
// with the Lohnart of the contract's kind, so a Minijob and an
// Übungsleiter contract of one person get separate lines.

var _ workforce.TraegerStaffExports = (*TraegerStaff)(nil)

// exportMonthBounds checks the month of an export: 2000..2100, not after
// the running month. It returns the first and the last day.
func (t *TraegerStaff) exportMonthBounds(month workforce.TraegerExportMonth) (calendar.Date, calendar.Date, error) {
	if month.Year < 2000 || month.Year > 2100 || month.Month < 1 || month.Month > 12 {
		return "", "", fmt.Errorf("%w: the month lies outside 2000 to 2100", workforce.ErrTraegerExportInvalid)
	}
	first := calendar.NewDate(month.Year, time.Month(month.Month), 1)
	today := calendar.DateFromTime(t.clock.Now())
	if calendar.NewDate(today.Year(), today.Month(), 1).Before(first) {
		return "", "", fmt.Errorf("%w: the month lies in the future", workforce.ErrTraegerExportInvalid)
	}
	next := calendar.NewDate(month.Year, time.Month(month.Month)+1, 1)
	return first, next.AddDays(-1), nil
}

// payrollRun is one computation of the file: the report and the lines.
type payrollRun struct {
	report   workforce.TraegerPayrollReport
	lines    []domain.DatevPayrollLine
	settings workforce.TraegerPayrollSettings
}

// PayrollReport is the check the page shows before the download.
func (t *TraegerStaff) PayrollReport(ctx context.Context, actor workforce.TraegerStaffActor, month workforce.TraegerExportMonth) (workforce.TraegerPayrollReport, error) {
	run, err := t.payrollRun(ctx, actor, month, workforce.TraegerStaffViewPayrollReport)
	return run.report, err
}

// PayrollFile renders the file; while the report names a reason, it refuses
// with the report.
func (t *TraegerStaff) PayrollFile(ctx context.Context, actor workforce.TraegerStaffActor, month workforce.TraegerExportMonth) (workforce.TraegerExportFile, error) {
	run, err := t.payrollRun(ctx, actor, month, workforce.TraegerStaffViewPayrollExport)
	if err != nil {
		return workforce.TraegerExportFile{}, err
	}
	if !run.report.Ready {
		return workforce.TraegerExportFile{}, &workforce.TraegerPayrollNotReadyError{Report: run.report}
	}
	file := workforce.TraegerExportFile{
		ContentType: "text/plain; charset=windows-1252",
		Filename:    fmt.Sprintf("lohnexport_%s_%04d-%02d.txt", month.Format, month.Year, month.Month),
	}
	if month.Format == workforce.TraegerPayrollFormatLodas {
		file.Data = domain.WriteDatevLodas(run.lines, run.settings.ConsultantNumber, run.settings.ClientNumber, month.Year, month.Month)
	} else {
		file.Data = domain.WriteDatevLug(run.lines)
	}
	return file, nil
}

func (t *TraegerStaff) payrollRun(ctx context.Context, actor workforce.TraegerStaffActor, month workforce.TraegerExportMonth, view string) (payrollRun, error) {
	if month.Format != workforce.TraegerPayrollFormatLodas && month.Format != workforce.TraegerPayrollFormatLug {
		return payrollRun{}, fmt.Errorf("%w: format must be %s or %s", workforce.ErrTraegerExportInvalid,
			workforce.TraegerPayrollFormatLodas, workforce.TraegerPayrollFormatLug)
	}
	first, last, err := t.exportMonthBounds(month)
	if err != nil {
		return payrollRun{}, err
	}
	if t.ports.Exports == nil || t.ports.Payroll == nil {
		return payrollRun{}, errors.New("traeger payroll export: the school months and the payroll settings are required")
	}
	settings, err := t.ports.Payroll.TraegerPayrollSettings(ctx, actor.OrganizationID)
	if err != nil {
		return payrollRun{}, fmt.Errorf("read the payroll settings: %w", err)
	}
	scene, err := t.exportScene(ctx, actor, func(ctx context.Context) ([]domain.TraegerStaffContract, error) {
		return t.store.ListMonthContracts(ctx, actor.OrganizationID, first, last)
	})
	if err != nil {
		return payrollRun{}, err
	}
	months, err := t.schoolPayrollMonths(ctx, actor, scene, view, month)
	if err != nil {
		return payrollRun{}, err
	}
	book := newPayrollBook(settings, month)
	owners, changes := scene.siteOwners()
	for _, contract := range scene.contractsByName() {
		book.add(scene.records[contract.RecordID], contract, contractMonths(contract, owners, months))
	}
	book.contractChanges(scene, changes)
	return payrollRun{report: book.finish(scene, months), lines: book.lines, settings: settings}, nil
}

// exportScene is what an export reads in the Träger transaction: the live
// schools, the records and, for the payroll file, the month's contracts.
type exportScene struct {
	schools   []workforce.TraegerStaffSchool
	names     map[int64]string
	records   map[int64]domain.TraegerStaffRecord
	contracts []domain.TraegerStaffContract
}

func (t *TraegerStaff) exportScene(ctx context.Context, actor workforce.TraegerStaffActor,
	contracts func(context.Context) ([]domain.TraegerStaffContract, error),
) (exportScene, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return exportScene{}, err
	}
	scene := exportScene{schools: schools, names: schoolNames(schools), records: map[int64]domain.TraegerStaffRecord{}}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		records, err := t.store.ListStaffRecords(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		for _, record := range records {
			scene.records[record.ID] = record
		}
		if contracts != nil {
			scene.contracts, err = contracts(ctx)
		}
		return err
	})
	if err != nil {
		return exportScene{}, publicTraegerStaffError(err)
	}
	return scene, nil
}

// contractsByName orders the contracts by the name of the person, then by
// kind and start.
func (s exportScene) contractsByName() []domain.TraegerStaffContract {
	contracts := slices.Clone(s.contracts)
	slices.SortStableFunc(contracts, func(a, b domain.TraegerStaffContract) int {
		ra, rb := s.records[a.RecordID], s.records[b.RecordID]
		if order := compareNames(ra, rb); order != 0 {
			return order
		}
		if order := slices.Index(domain.ContractKinds, a.Kind) - slices.Index(domain.ContractKinds, b.Kind); order != 0 {
			return order
		}
		return a.StartsOn.Compare(b.StartsOn)
	})
	return contracts
}

func compareNames(a, b domain.TraegerStaffRecord) int {
	if order := strings.Compare(strings.ToLower(a.LastName), strings.ToLower(b.LastName)); order != 0 {
		return order
	}
	if order := strings.Compare(strings.ToLower(a.FirstName), strings.ToLower(b.FirstName)); order != 0 {
		return order
	}
	return int(a.ID - b.ID)
}

// siteKey names one employment at one school.
type siteKey struct{ school, staff int64 }

// schoolPayrollMonths reads the month of every Einsatzort of the contracts,
// one tenant transaction per school, the access entry first.
func (t *TraegerStaff) schoolPayrollMonths(ctx context.Context, actor workforce.TraegerStaffActor, scene exportScene,
	view string, month workforce.TraegerExportMonth,
) (map[siteKey]schoolPayrollMonth, error) {
	staffBySchool := scene.contractStaff()
	months := map[siteKey]schoolPayrollMonth{}
	for _, school := range scene.schools {
		staffIDs := staffBySchool[school.ID]
		if len(staffIDs) == 0 {
			continue
		}
		var read []workforce.TraegerPayrollMonth
		err := t.ports.Runtime.WithinSchool(ctx, school.ID, func(ctx context.Context) error {
			if err := t.recordExportAccess(ctx, actor, view, staffIDs); err != nil {
				return err
			}
			var err error
			read, err = t.ports.Exports.TraegerPayrollMonths(ctx, staffIDs, month.Year, month.Month)
			return err
		})
		if err != nil {
			return nil, err
		}
		for _, value := range read {
			months[siteKey{school.ID, value.StaffID}] = schoolPayrollMonth{school: school.Name, month: value}
		}
	}
	return months, nil
}

// contractStaff groups the Einsatzorte of the contracts at live schools by
// school.
func (s exportScene) contractStaff() map[int64][]int64 {
	staffBySchool := map[int64][]int64{}
	for _, contract := range s.contracts {
		for _, target := range contract.Targets {
			if _, live := s.names[target.SchoolID]; live && !slices.Contains(staffBySchool[target.SchoolID], target.StaffID) {
				staffBySchool[target.SchoolID] = append(staffBySchool[target.SchoolID], target.StaffID)
			}
		}
	}
	return staffBySchool
}

func (t *TraegerStaff) recordExportAccess(ctx context.Context, actor workforce.TraegerStaffActor, view string, staffIDs []int64) error {
	return t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
		OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: view, Rows: len(staffIDs), StaffIDs: staffIDs,
	})
}

// schoolPayrollMonth is the month of one Einsatzort with its school.
type schoolPayrollMonth struct {
	school string
	month  workforce.TraegerPayrollMonth
}

// siteOwners decides which contract books the month of each Einsatzort. A
// school's month of an employment is one sum; when one contract ends and the
// next starts at the same employment within the month, the later contract
// books it, so no value counts twice. changes names the records with such a
// change; the report shows them.
func (s exportScene) siteOwners() (map[siteKey]int64, map[int64]bool) {
	contracts := slices.Clone(s.contracts)
	slices.SortStableFunc(contracts, func(a, b domain.TraegerStaffContract) int {
		if order := a.StartsOn.Compare(b.StartsOn); order != 0 {
			return order
		}
		return int(a.ID - b.ID)
	})
	owners, changes := map[siteKey]int64{}, map[int64]bool{}
	for _, contract := range contracts {
		for _, target := range contract.Targets {
			// A deleted school logs no access, so its change names nobody.
			if _, live := s.names[target.SchoolID]; !live {
				continue
			}
			key := siteKey{target.SchoolID, target.StaffID}
			if previous, ok := owners[key]; ok && previous != contract.ID {
				changes[contract.RecordID] = true
			}
			owners[key] = contract.ID
		}
	}
	return owners, changes
}

// contractMonths are the months of the Einsatzorte the contract books; an
// employment the school no longer lists has none.
func contractMonths(contract domain.TraegerStaffContract, owners map[siteKey]int64, months map[siteKey]schoolPayrollMonth) []schoolPayrollMonth {
	var result []schoolPayrollMonth
	seen := map[siteKey]bool{}
	for _, target := range contract.Targets {
		key := siteKey{target.SchoolID, target.StaffID}
		if month, ok := months[key]; ok && !seen[key] && owners[key] == contract.ID {
			seen[key] = true
			result = append(result, month)
		}
	}
	return result
}
