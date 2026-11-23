package application

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// payrollBook collects the lines of the Träger's payroll file and its
// report, contract after contract.
type payrollBook struct {
	settings workforce.TraegerPayrollSettings
	report   workforce.TraegerPayrollReport
	lines    []domain.DatevPayrollLine
	// index finds the line of a person, Lohnart and unit, so two contracts
	// of one kind book one line.
	index   map[payrollLineKey]int
	people  map[int64]bool
	missing map[int64]bool
	gaps    map[workforce.TraegerPayrollGap]bool
	kinds   map[string]*workforce.TraegerPayrollKindCount
}

type payrollLineKey struct {
	number, wageType string
	days             bool
}

func newPayrollBook(settings workforce.TraegerPayrollSettings, month workforce.TraegerExportMonth) *payrollBook {
	return &payrollBook{
		settings: settings,
		report: workforce.TraegerPayrollReport{
			Year: month.Year, Month: month.Month, Format: month.Format,
			Kinds: []workforce.TraegerPayrollKindCount{}, WithoutNumber: []workforce.TraegerExportPerson{},
			Unconfigured: []workforce.TraegerPayrollGap{}, OpenSchools: []string{}, ContractChanges: []workforce.TraegerExportPerson{},
		},
		index: map[payrollLineKey]int{}, people: map[int64]bool{}, missing: map[int64]bool{},
		gaps: map[workforce.TraegerPayrollGap]bool{}, kinds: map[string]*workforce.TraegerPayrollKindCount{},
	}
}

// add books one contract: the sum of its Einsatzorte per category with the
// Lohnart of its kind. A person without Personalnummer is named once and
// books nothing.
func (b *payrollBook) add(record domain.TraegerStaffRecord, contract domain.TraegerStaffContract, months []schoolPayrollMonth) {
	if len(months) == 0 {
		return
	}
	number := ""
	if record.PersonnelNumber != nil {
		number = *record.PersonnelNumber
	}
	if number == "" {
		if !b.missing[record.ID] {
			b.missing[record.ID] = true
			b.report.WithoutNumber = append(b.report.WithoutNumber, workforce.TraegerExportPerson{
				RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName,
			})
		}
		return
	}
	b.people[record.ID] = true
	count := b.kind(contract.Kind)
	count.Contracts++
	sum := sumPayrollMonths(months)
	for _, category := range workforce.TraegerPayrollCategories {
		value, ok := payrollCategoryValue(category, sum, b.settings.Units[category])
		if !ok {
			continue
		}
		wageType := b.settings.WageTypes[category][contract.Kind]
		if wageType == "" || !value.unitChosen {
			b.gaps[workforce.TraegerPayrollGap{Category: category, Kind: contract.Kind}] = true
			continue
		}
		if b.book(number, wageType, value) {
			count.Lines++
		}
	}
}

// contractChanges names the people whose contract changes within the month
// at one employment; the later contract books the whole month.
func (b *payrollBook) contractChanges(scene exportScene, changes map[int64]bool) {
	for _, record := range scene.recordsByName() {
		if changes[record.ID] {
			b.report.ContractChanges = append(b.report.ContractChanges, workforce.TraegerExportPerson{
				RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName,
			})
		}
	}
}

func (b *payrollBook) kind(kind string) *workforce.TraegerPayrollKindCount {
	if count, ok := b.kinds[kind]; ok {
		return count
	}
	count := &workforce.TraegerPayrollKindCount{Kind: kind}
	b.kinds[kind] = count
	return count
}

// book adds the value to the person's line of the Lohnart and reports
// whether the line is new.
func (b *payrollBook) book(number, wageType string, value payrollValue) bool {
	key := payrollLineKey{number: number, wageType: wageType, days: value.inDays}
	if i, ok := b.index[key]; ok {
		if value.inDays {
			*b.lines[i].Days += value.days
		} else {
			*b.lines[i].HoursMinutes += value.minutes
		}
		return false
	}
	line := domain.DatevPayrollLine{PersonnelNumber: number, WageType: wageType}
	if value.inDays {
		days := value.days
		line.Days = &days
	} else {
		minutes := value.minutes
		line.HoursMinutes = &minutes
	}
	b.index[key] = len(b.lines)
	b.lines = append(b.lines, line)
	return true
}

// finish fills the counts and decides whether the file can be made.
func (b *payrollBook) finish(scene exportScene, months map[siteKey]schoolPayrollMonth) workforce.TraegerPayrollReport {
	report := b.report
	report.People, report.LineCount = len(b.people), len(b.lines)
	report.Kinds, report.Contracts = b.kindCounts()
	report.Unconfigured = b.orderedGaps()
	report.Schools, report.OpenSchools = monthSchools(scene, months)
	report.MissingClient = report.Format == workforce.TraegerPayrollFormatLodas &&
		(b.settings.ConsultantNumber == "" || b.settings.ClientNumber == "")
	report.NoWageType = !anyWageType(b.settings)
	report.Ready = len(report.WithoutNumber) == 0 && !report.MissingClient && !report.NoWageType && report.LineCount > 0
	return report
}

// kindCounts lists the kinds in display order with the contract total.
func (b *payrollBook) kindCounts() ([]workforce.TraegerPayrollKindCount, int) {
	kinds, total := []workforce.TraegerPayrollKindCount{}, 0
	for _, kind := range domain.ContractKinds {
		if count, ok := b.kinds[kind]; ok {
			total += count.Contracts
			kinds = append(kinds, *count)
		}
	}
	return kinds, total
}

// orderedGaps lists the gaps by category and kind.
func (b *payrollBook) orderedGaps() []workforce.TraegerPayrollGap {
	gaps := []workforce.TraegerPayrollGap{}
	for _, category := range workforce.TraegerPayrollCategories {
		for _, kind := range domain.ContractKinds {
			if gap := (workforce.TraegerPayrollGap{Category: category, Kind: kind}); b.gaps[gap] {
				gaps = append(gaps, gap)
			}
		}
	}
	return gaps
}

// monthSchools counts the schools with a month and names, in school order,
// those with a month not yet closed.
func monthSchools(scene exportScene, months map[siteKey]schoolPayrollMonth) (int, []string) {
	schools, open := map[string]bool{}, map[string]bool{}
	for _, month := range months {
		schools[month.school] = true
		if !month.month.Closed {
			open[month.school] = true
		}
	}
	names := []string{}
	for _, school := range scene.schools {
		if open[school.Name] && !slices.Contains(names, school.Name) {
			names = append(names, school.Name)
		}
	}
	return len(schools), names
}

func anyWageType(settings workforce.TraegerPayrollSettings) bool {
	for _, kinds := range settings.WageTypes {
		for _, number := range kinds {
			if number != "" {
				return true
			}
		}
	}
	return false
}

// sumPayrollMonths adds the months of a contract's Einsatzorte.
func sumPayrollMonths(months []schoolPayrollMonth) workforce.TraegerPayrollMonth {
	var sum workforce.TraegerPayrollMonth
	for _, entry := range months {
		month := entry.month
		sum.RegularMinutes += month.RegularMinutes
		sum.PlusMinutes += month.PlusMinutes
		sum.PayoutMinutes += month.PayoutMinutes
		sum.CompTimeMinutes += month.CompTimeMinutes
		sum.SickMinutes += month.SickMinutes
		sum.VacationMinutes += month.VacationMinutes
		sum.TrainingMinutes += month.TrainingMinutes
		sum.SickDays += month.SickDays
		sum.VacationDays += month.VacationDays
		sum.TrainingDays += month.TrainingDays
	}
	return sum
}

// payrollValue is the value of one category: minutes, or days when the
// Träger books the category in days.
type payrollValue struct {
	minutes    int
	days       float64
	inDays     bool
	unitChosen bool
}

// payrollCategoryValue picks the value of a category like the school's file
// does (datevCategoryValue): a day category books in the unit the Träger
// chose and needs one. ok is false for a zero value, which books no line.
func payrollCategoryValue(category string, month workforce.TraegerPayrollMonth, unit string) (payrollValue, bool) {
	value := payrollValue{unitChosen: true}
	switch category {
	case workforce.TraegerPayrollRegular:
		value.minutes = month.RegularMinutes
	case workforce.TraegerPayrollPlus:
		value.minutes = month.PlusMinutes
	case workforce.TraegerPayrollPayout:
		value.minutes = month.PayoutMinutes
	case workforce.TraegerPayrollCompTime:
		value.minutes = month.CompTimeMinutes
	case workforce.TraegerPayrollSick:
		value.minutes, value.days = month.SickMinutes, month.SickDays
	case workforce.TraegerPayrollVacation:
		value.minutes, value.days = month.VacationMinutes, month.VacationDays
	case workforce.TraegerPayrollTraining:
		value.minutes, value.days = month.TrainingMinutes, month.TrainingDays
	default:
		return payrollValue{}, false
	}
	if !slices.Contains(workforce.TraegerPayrollDayCategories, category) {
		return value, value.minutes != 0
	}
	value.unitChosen = unit == workforce.TraegerPayrollUnitHours || unit == workforce.TraegerPayrollUnitDays
	value.inDays = unit == workforce.TraegerPayrollUnitDays
	if value.inDays {
		return value, value.days != 0
	}
	return value, value.minutes != 0 || (!value.unitChosen && value.days != 0)
}
