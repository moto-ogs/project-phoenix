package application

import (
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// payrollBook collects the files of the Träger's payroll export and its
// report, contract after contract. In the form of the Träger there is one
// file; in the form per employer one per DATEV client (ADR 0320).
type payrollBook struct {
	settings workforce.TraegerPayrollSettings
	report   workforce.TraegerPayrollReport
	files    []*payrollFile
	byKey    map[string]*payrollFile
	people   map[int64]bool
	missing  map[int64]bool
	gaps     map[workforce.TraegerPayrollGap]bool
	kinds    map[string]*workforce.TraegerPayrollKindCount
	// inFiles names the files of each record, for the people in several.
	inFiles map[int64]map[string]bool
	checks  map[employerKey]*workforce.TraegerPayrollEmployerCheck
}

// payrollFile is one file: its report, its lines and what decides whether
// it can be made.
type payrollFile struct {
	report workforce.TraegerPayrollFile
	lines  []domain.DatevPayrollLine
	// index finds the line of a person, Lohnart, Kostenstelle and unit, so
	// two contracts of one kind book one line.
	index     map[payrollLineKey]int
	people    map[int64]bool
	missing   map[int64]bool
	numbers   map[string][]int64
	employers map[workforce.TraegerPayrollFileEmployer]bool
	schools   map[string]bool
	// costCenterMissing: a line of an employer without Kostenstelle would
	// stand unmarked in the one file.
	costCenterMissing bool
}

type payrollLineKey struct {
	number, wageType, costCenter string
	days                         bool
}

func newPayrollBook(settings workforce.TraegerPayrollSettings, month workforce.TraegerExportMonth) *payrollBook {
	return &payrollBook{
		settings: settings,
		report: workforce.TraegerPayrollReport{
			Year: month.Year, Month: month.Month, Format: month.Format, Form: payrollForm(settings),
			Kinds: []workforce.TraegerPayrollKindCount{}, WithoutNumber: []workforce.TraegerExportPerson{},
			Unconfigured: []workforce.TraegerPayrollGap{}, OpenSchools: []string{}, ContractChanges: []workforce.TraegerExportPerson{},
			Files: []workforce.TraegerPayrollFile{}, Employers: []workforce.TraegerPayrollEmployerCheck{},
			InSeveralFiles: []workforce.TraegerExportPerson{},
		},
		byKey: map[string]*payrollFile{}, people: map[int64]bool{}, missing: map[int64]bool{},
		gaps: map[workforce.TraegerPayrollGap]bool{}, kinds: map[string]*workforce.TraegerPayrollKindCount{},
		inFiles: map[int64]map[string]bool{}, checks: map[employerKey]*workforce.TraegerPayrollEmployerCheck{},
	}
}

// payrollForm is the form the settings choose; anything but the form per
// employer is the one file of the Träger.
func payrollForm(settings workforce.TraegerPayrollSettings) string {
	if settings.Form == workforce.TraegerPayrollFormArbeitgeber {
		return workforce.TraegerPayrollFormArbeitgeber
	}
	return workforce.TraegerPayrollFormTraeger
}

// add books one contract: per employer of its Einsatzorte the sum of their
// months per category, with the Lohnart of its kind. A group without
// personnel number names the person once and books nothing.
func (b *payrollBook) add(record domain.TraegerStaffRecord, contract domain.TraegerStaffContract, groups []payrollGroup) {
	counted := false
	for _, group := range groups {
		file := b.file(group.target)
		b.noteEmployer(group.target, file)
		if group.target.number == "" {
			b.withoutNumber(record, file)
			continue
		}
		b.people[record.ID], file.people[record.ID] = true, true
		b.noteFile(record.ID, file)
		file.noteNumber(group.target.number, record.ID)
		count := b.kind(contract.Kind)
		if !counted {
			count.Contracts++
			counted = true
		}
		for _, month := range group.months {
			file.schools[month.school] = true
		}
		b.bookGroup(file, contract.Kind, count, group)
	}
}

func (b *payrollBook) bookGroup(file *payrollFile, kind string, count *workforce.TraegerPayrollKindCount, group payrollGroup) {
	sum := sumPayrollMonths(group.months)
	for _, category := range workforce.TraegerPayrollCategories {
		value, ok := payrollCategoryValue(category, sum, b.settings.Units[category])
		if !ok {
			continue
		}
		wageType := b.settings.WageTypes[category][kind]
		if wageType == "" || !value.unitChosen {
			b.gaps[workforce.TraegerPayrollGap{Category: category, Kind: kind}] = true
			continue
		}
		if file.book(group.target.number, wageType, group.target.costCenter, value) {
			count.Lines++
		}
	}
}

// file returns the file of a target, a new one at its first line.
func (b *payrollBook) file(target payrollTarget) *payrollFile {
	file, ok := b.byKey[target.fileKey]
	if !ok {
		file = &payrollFile{
			report: workforce.TraegerPayrollFile{
				Key: target.fileKey, ConsultantNumber: target.consultant, ClientNumber: target.client,
				Employers: []workforce.TraegerPayrollFileEmployer{}, Schools: []string{},
				WithoutNumber: []workforce.TraegerExportPerson{}, Duplicates: []workforce.TraegerPayrollDuplicate{},
			},
			index: map[payrollLineKey]int{}, people: map[int64]bool{}, missing: map[int64]bool{},
			numbers: map[string][]int64{}, employers: map[workforce.TraegerPayrollFileEmployer]bool{}, schools: map[string]bool{},
		}
		b.byKey[target.fileKey] = file
		b.files = append(b.files, file)
	}
	if !file.employers[target.employer] {
		file.employers[target.employer] = true
		file.report.Employers = append(file.report.Employers, target.employer)
	}
	return file
}

// noteEmployer keeps what the values of a body besides the Träger lack.
func (b *payrollBook) noteEmployer(target payrollTarget, file *payrollFile) {
	if target.check == nil {
		return
	}
	check, ok := b.checks[target.check.key]
	if !ok {
		check = &workforce.TraegerPayrollEmployerCheck{
			SchoolID: ident.ID(target.check.key.school), SchoolName: target.check.schoolName,
			Body: target.employer.Body, Name: target.employer.Name,
		}
		if b.report.Form == workforce.TraegerPayrollFormArbeitgeber {
			check.MissingClient = target.consultant == "" || target.client == ""
		} else {
			check.MissingCostCenter = target.costCenter == ""
		}
		b.checks[target.check.key] = check
	}
	if check.MissingCostCenter {
		file.costCenterMissing = true
	}
}

func (b *payrollBook) withoutNumber(record domain.TraegerStaffRecord, file *payrollFile) {
	person := workforce.TraegerExportPerson{RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName}
	if !b.missing[record.ID] {
		b.missing[record.ID] = true
		b.report.WithoutNumber = append(b.report.WithoutNumber, person)
	}
	if !file.missing[record.ID] {
		file.missing[record.ID] = true
		file.report.WithoutNumber = append(file.report.WithoutNumber, person)
	}
}

func (b *payrollBook) noteFile(recordID int64, file *payrollFile) {
	if b.inFiles[recordID] == nil {
		b.inFiles[recordID] = map[string]bool{}
	}
	b.inFiles[recordID][file.report.Key] = true
}

// noteNumber keeps which records book under a number in the file.
func (f *payrollFile) noteNumber(number string, recordID int64) {
	if !slices.Contains(f.numbers[number], recordID) {
		f.numbers[number] = append(f.numbers[number], recordID)
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
func (f *payrollFile) book(number, wageType, costCenter string, value payrollValue) bool {
	key := payrollLineKey{number: number, wageType: wageType, costCenter: costCenter, days: value.inDays}
	if i, ok := f.index[key]; ok {
		if value.inDays {
			*f.lines[i].Days += value.days
		} else {
			*f.lines[i].HoursMinutes += value.minutes
		}
		return false
	}
	line := domain.DatevPayrollLine{PersonnelNumber: number, WageType: wageType, CostCenter: costCenter}
	if value.inDays {
		days := value.days
		line.Days = &days
	} else {
		minutes := value.minutes
		line.HoursMinutes = &minutes
	}
	f.index[key] = len(f.lines)
	f.lines = append(f.lines, line)
	return true
}

// finish fills the counts and decides which file can be made.
func (b *payrollBook) finish(scene exportScene, months map[siteKey]schoolPayrollMonth) workforce.TraegerPayrollReport {
	report := b.report
	report.People = len(b.people)
	report.Kinds, report.Contracts = b.kindCounts()
	report.Unconfigured = b.orderedGaps()
	report.Schools, report.OpenSchools = monthSchools(scene, months)
	report.MissingClient = report.Form == workforce.TraegerPayrollFormTraeger && report.Format == workforce.TraegerPayrollFormatLodas &&
		(b.settings.ConsultantNumber == "" || b.settings.ClientNumber == "")
	report.NoWageType = !anyWageType(b.settings)
	report.Employers = b.orderedChecks(scene)
	report.Files = b.finishFiles(scene)
	report.InSeveralFiles = b.inSeveralFiles(scene)
	report.Ready = len(report.Files) > 0
	for _, file := range report.Files {
		report.LineCount += file.LineCount
		report.Ready = report.Ready && file.Ready
	}
	return report
}

// finishFiles completes the report of every file: the Träger's own file
// first, then by employer name.
func (b *payrollBook) finishFiles(scene exportScene) []workforce.TraegerPayrollFile {
	files := make([]workforce.TraegerPayrollFile, 0, len(b.files))
	for _, file := range b.files {
		report := file.report
		report.People, report.LineCount = len(file.people), len(file.lines)
		report.Schools = orderedSchools(scene, file.schools)
		report.MissingClient = report.ConsultantNumber == "" || report.ClientNumber == ""
		if b.report.Form == workforce.TraegerPayrollFormTraeger {
			report.MissingClient = report.MissingClient && b.report.Format == workforce.TraegerPayrollFormatLodas
		}
		report.Duplicates = file.duplicates(scene)
		report.Ready = len(report.WithoutNumber) == 0 && !report.MissingClient && anyWageType(b.settings) &&
			report.LineCount > 0 && len(report.Duplicates) == 0 && !file.costCenterMissing
		files = append(files, report)
	}
	slices.SortStableFunc(files, func(a, c workforce.TraegerPayrollFile) int {
		if order := boolOrder(hasTraeger(c)) - boolOrder(hasTraeger(a)); order != 0 {
			return order
		}
		return strings.Compare(fileName(a), fileName(c))
	})
	return files
}

func boolOrder(value bool) int {
	if value {
		return 1
	}
	return 0
}

func hasTraeger(file workforce.TraegerPayrollFile) bool {
	return slices.ContainsFunc(file.Employers, func(employer workforce.TraegerPayrollFileEmployer) bool {
		return employer.Body == payrollBodyTraeger
	})
}

func fileName(file workforce.TraegerPayrollFile) string {
	if len(file.Employers) == 0 {
		return file.Key
	}
	return strings.ToLower(file.Employers[0].Name)
}

// duplicates are the numbers two records would share in the file.
func (f *payrollFile) duplicates(scene exportScene) []workforce.TraegerPayrollDuplicate {
	duplicates := []workforce.TraegerPayrollDuplicate{}
	numbers := make([]string, 0, len(f.numbers))
	for number, records := range f.numbers {
		if len(records) > 1 {
			numbers = append(numbers, number)
		}
	}
	slices.Sort(numbers)
	for _, number := range numbers {
		duplicate := workforce.TraegerPayrollDuplicate{Number: number}
		for _, recordID := range f.numbers[number] {
			record := scene.records[recordID]
			duplicate.People = append(duplicate.People, workforce.TraegerExportPerson{
				RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName,
			})
		}
		duplicates = append(duplicates, duplicate)
	}
	return duplicates
}

// orderedChecks lists the bodies besides the Träger in school order.
func (b *payrollBook) orderedChecks(scene exportScene) []workforce.TraegerPayrollEmployerCheck {
	checks := []workforce.TraegerPayrollEmployerCheck{}
	for _, school := range scene.schools {
		for _, body := range []string{workforce.TraegerEmployerSchultraeger, workforce.TraegerEmployerGemeinde} {
			if check, ok := b.checks[employerKey{school.ID.Int64(), body}]; ok {
				checks = append(checks, *check)
			}
		}
	}
	return checks
}

// inSeveralFiles names, in the form per employer, the people with lines in
// more than one file.
func (b *payrollBook) inSeveralFiles(scene exportScene) []workforce.TraegerExportPerson {
	people := []workforce.TraegerExportPerson{}
	if b.report.Form != workforce.TraegerPayrollFormArbeitgeber {
		return people
	}
	for _, record := range scene.recordsByName() {
		if len(b.inFiles[record.ID]) > 1 {
			people = append(people, workforce.TraegerExportPerson{RecordID: ident.ID(record.ID), FirstName: record.FirstName, LastName: record.LastName})
		}
	}
	return people
}

// orderedSchools lists the names in school order.
func orderedSchools(scene exportScene, names map[string]bool) []string {
	ordered := []string{}
	for _, school := range scene.schools {
		if names[school.Name] && !slices.Contains(ordered, school.Name) {
			ordered = append(ordered, school.Name)
		}
	}
	return ordered
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
	return len(schools), orderedSchools(scene, open)
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
