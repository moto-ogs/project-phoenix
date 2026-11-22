package application

import (
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The rows of a correction file (#7764, ADR 0306). A row names a contract, a
// weekday, the module the contract books on it and the module that booking
// belongs to. The rows of one contract make one decision: a new version with
// the targets, or none.

// offeringCorrectionHeaderNames are the headers moto reads a field from,
// folded, in the order it prefers them.
var offeringCorrectionHeaderNames = map[string][]string{
	carecontract.OfferingCorrectionFieldContract: {"vertrag", "vertragid", "motovertragid", "vertragsnummer", "vertragnr", "vertragsnr"},
	carecontract.OfferingCorrectionFieldWeekday:  {"wochentag", "wochentage", "tag", "tage"},
	carecontract.OfferingCorrectionFieldCurrent: {"bisherigesangebot", "bisherigesmotoangebot", "bisherigesmodul", "angebotbisher",
		"modulbisher", "altesangebot", "altesmodul"},
	carecontract.OfferingCorrectionFieldTarget: {"zielangebot", "neuesangebot", "neuesmodul", "angebotneu", "modulneu"},
}

// offeringCorrectionIndex finds the column of every field and names the
// fields without one.
func offeringCorrectionIndex(headers []string) (map[string]int, []string) {
	index, missing := map[string]int{}, []string{}
	for _, field := range carecontract.OfferingCorrectionColumns {
		at := -1
		for _, name := range offeringCorrectionHeaderNames[field] {
			if at = slices.IndexFunc(headers, func(header string) bool { return textnorm.HeaderKey(header) == name }); at >= 0 {
				break
			}
		}
		if at < 0 {
			missing = append(missing, field)
			continue
		}
		index[field] = at
	}
	return index, missing
}

// correctionRow is one row of the file.
type correctionRow struct {
	line    int
	days    []string
	daysOK  bool
	current string
	target  string
}

// correctionGroup are the rows of one contract, in the order of the file.
type correctionGroup struct {
	reference string
	id        int64
	rows      []correctionRow
}

// readCorrectionGroups reads the rows and puts those of one contract
// together, by the first line of each contract.
func readCorrectionGroups(table textnorm.CSVTable, index map[string]int) []correctionGroup {
	cell := func(cells []string, field string) string {
		if at := index[field]; at < len(cells) {
			return strings.TrimSpace(cells[at])
		}
		return ""
	}
	groups, at := []correctionGroup{}, map[string]int{}
	for n, cells := range table.Rows {
		reference := cell(cells, carecontract.OfferingCorrectionFieldContract)
		id, key := correctionContractID(reference), reference
		if id > 0 {
			key = strconv.FormatInt(id, 10)
		}
		row := correctionRow{line: table.Lines[n], current: cell(cells, carecontract.OfferingCorrectionFieldCurrent),
			target: cell(cells, carecontract.OfferingCorrectionFieldTarget)}
		row.days, row.daysOK = parseImportWeekdays(cell(cells, carecontract.OfferingCorrectionFieldWeekday))
		position, seen := at[key]
		if !seen || key == "" {
			position = len(groups)
			at[key] = position
			groups = append(groups, correctionGroup{reference: reference, id: id})
		}
		groups[position].rows = append(groups[position].rows, row)
	}
	return groups
}

// correctionContractID reads the number of a contract; 0 for a cell that
// names none.
func correctionContractID(reference string) int64 {
	id, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(reference, "#")), 10, 64)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func correctionContractIDs(groups []correctionGroup) []int64 {
	ids := []int64{}
	for _, group := range groups {
		if group.id > 0 {
			ids = append(ids, group.id)
		}
	}
	return ids
}

// correctionCandidate is a contract of the file with what the correction
// does with it and, for a ready one, its new version.
type correctionCandidate struct {
	contract carecontract.OfferingCorrectionContract
	version  *ports.CorrectedVersion
	lines    []int
}

// correctionCheck decides the contracts of a file on one day.
type correctionCheck struct {
	contracts map[int64]ports.CorrectableContract
	schools   map[int64]importSchool
	day       calendar.Date
}

func newCorrectionCheck(contracts []ports.CorrectableContract, schools []importSchool, day calendar.Date) correctionCheck {
	check := correctionCheck{contracts: map[int64]ports.CorrectableContract{}, schools: map[int64]importSchool{}, day: day}
	for _, contract := range contracts {
		check.contracts[contract.ID] = contract
	}
	for _, school := range schools {
		check.schools[school.school.ID] = school
	}
	return check
}

// correctionEval collects what the rows of one contract say.
type correctionEval struct {
	check    correctionCheck
	result   *carecontract.OfferingCorrectionContract
	school   importSchool
	day      calendar.Date
	services []carecontract.Service
	// replaced tells per service of services the line that gave it its
	// target; 0 for a service no row changed.
	replaced []int
	seen     map[string]bool
	held     bool
}

func (e *correctionEval) problem(line int, field, code string) {
	e.result.Problems = append(e.result.Problems, carecontract.OfferingCorrectionProblem{Line: line, Field: field, Code: code})
}

func (e *correctionEval) hint(code string) {
	if !slices.Contains(e.result.Hints, code) {
		e.result.Hints = append(e.result.Hints, code)
	}
}

// change notes that the bookings of from on day go to the module to.
func (e *correctionEval) change(day, from, to string) {
	changes := e.result.Changes
	at := slices.IndexFunc(changes, func(c carecontract.OfferingCorrectionChange) bool { return c.From == from && c.To == to })
	if at < 0 {
		at = len(changes)
		changes = append(changes, carecontract.OfferingCorrectionChange{From: from, To: to, Weekdays: []string{}})
	}
	if !slices.Contains(changes[at].Weekdays, day) {
		changes[at].Weekdays = append(changes[at].Weekdays, day)
		slices.SortFunc(changes[at].Weekdays, func(a, b string) int { return slices.Index(weekdayOrder, a) - slices.Index(weekdayOrder, b) })
	}
	e.result.Changes = changes
}

// candidate decides one contract of the file.
func (c correctionCheck) candidate(group correctionGroup) correctionCandidate {
	result := carecontract.OfferingCorrectionContract{Reference: group.reference, Line: group.rows[0].line,
		Status:  carecontract.OfferingCorrectionInvalid,
		Changes: []carecontract.OfferingCorrectionChange{}, Problems: []carecontract.OfferingCorrectionProblem{}, Hints: []string{}}
	candidate := correctionCandidate{}
	for _, row := range group.rows {
		candidate.lines = append(candidate.lines, row.line)
	}
	eval := &correctionEval{check: c, result: &result, seen: map[string]bool{}}
	contract, ok := eval.contract(group)
	var base carecontract.Version
	if ok {
		base, ok = eval.base(contract)
	}
	if ok {
		for _, row := range group.rows {
			eval.row(row)
		}
		eval.doubleBooked()
		candidate.version = eval.settle(contract, base)
	}
	candidate.contract = result
	return candidate
}

// contract finds the contract the rows name and tells whether the
// correction may change it.
func (e *correctionEval) contract(group correctionGroup) (ports.CorrectableContract, bool) {
	line := group.rows[0].line
	if group.reference == "" {
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemMissing)
		return ports.CorrectableContract{}, false
	}
	if group.id == 0 {
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemInvalid)
		return ports.CorrectableContract{}, false
	}
	contract, found := e.check.contracts[group.id]
	if !found {
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemUnknown)
		return ports.CorrectableContract{}, false
	}
	e.result.ContractID, e.result.SchoolID = ident.ID(contract.ID), ident.ID(contract.SchoolID)
	e.school = e.check.schools[contract.SchoolID]
	e.result.SchoolName = e.school.school.Name
	if len(contract.Versions) > 0 {
		newest := contract.Versions[len(contract.Versions)-1]
		e.result.ChildFirstName, e.result.ChildLastName = newest.ChildFirstName, newest.ChildLastName
	}
	switch {
	case contract.FollowsBookings:
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemFollowsBookings)
	case contract.Status != carecontract.StatusActive || len(contract.Versions) == 0:
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemNotActive)
	}
	return contract, len(e.result.Problems) == 0
}

// base is the version the correction starts from: the one in force on the
// day, or the first version of a contract that begins later. A version that
// starts after the day, and a contract that ends before it, leave the
// contract as it is.
func (e *correctionEval) base(contract ports.CorrectableContract) (carecontract.Version, bool) {
	line := e.result.Line
	e.day = e.check.day
	if first := contract.Versions[0].EffectiveFrom; first.After(e.day) {
		e.day = first
		e.hint(carecontract.OfferingCorrectionHintStartMoved)
	}
	base, _ := versionAt(contract.Versions, e.day)
	if _, later := versionAfter(contract.Versions, e.day); later {
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemLaterVersion)
		return base, false
	}
	// The end is exclusive: a contract whose last day is the day before
	// does not reach the day.
	if end := earliestImportEnd(base.EndsOn, contract.EndsOn); end != nil && !end.After(e.day) {
		e.problem(line, carecontract.OfferingCorrectionFieldContract, carecontract.OfferingCorrectionProblemEnded)
		return base, false
	}
	e.services = slices.Clone(promised(base, e.day))
	e.replaced = make([]int, len(e.services))
	return base, true
}

// row reads one row: every weekday it names moves the booking of its module
// to the target.
func (e *correctionEval) row(row correctionRow) {
	if !row.daysOK {
		e.problem(row.line, carecontract.OfferingCorrectionFieldWeekday, carecontract.OfferingCorrectionProblemInvalid)
	}
	if row.current == "" {
		e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemMissing)
	}
	if !row.daysOK || row.current == "" {
		return
	}
	for _, day := range row.days {
		e.booking(row, day)
	}
}

// booking moves the booking of one weekday.
func (e *correctionEval) booking(row correctionRow, day string) {
	key := day + "\x1f" + textnorm.HeaderKey(row.current)
	if e.seen[key] {
		e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemRepeated)
		return
	}
	e.seen[key] = true
	// A row names a module the contract books now: a booking another row
	// already moved is not found again under its new module, so a row may
	// name a module another row moves a booking to (A to B, B to C).
	at := -1
	for n, s := range e.services {
		if e.replaced[n] == 0 && s.Weekday == day && textnorm.HeaderKey(s.ModuleName) == textnorm.HeaderKey(row.current) {
			at = n
			break
		}
	}
	if row.target == "" {
		e.heldBooking(row, day, at)
		return
	}
	target, code := e.target(row.target, day)
	if code != "" {
		e.problem(row.line, carecontract.OfferingCorrectionFieldTarget, code)
		return
	}
	if at < 0 {
		// A booking that names its target already is done: a repeated run
		// finds the target where the file's module was.
		if !e.books(day, target.ID) {
			e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemNotBooked)
		}
		return
	}
	service := e.services[at]
	if service.CareOfferingID.Int64() == target.ID {
		return
	}
	if end := target.EndTimes[day]; end != "" && service.EndsAt != "" && end != service.EndsAt {
		e.hint(carecontract.OfferingCorrectionHintEndTimeDiffers)
	}
	e.change(day, service.ModuleName, target.Name)
	e.services[at].CareOfferingID, e.services[at].ModuleName = ident.ID(target.ID), target.Name
	e.replaced[at] = row.line
}

// heldBooking is a booking the office has not decided yet.
func (e *correctionEval) heldBooking(row correctionRow, day string, at int) {
	if at < 0 {
		e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemNotBooked)
		return
	}
	e.held = true
	e.change(day, e.services[at].ModuleName, "")
}

func (e *correctionEval) books(day string, offeringID int64) bool {
	return slices.ContainsFunc(e.services, func(s carecontract.Service) bool {
		return s.Weekday == day && s.CareOfferingID.Int64() == offeringID
	})
}

// target finds the module of a name at the school of the contract and tells
// why a booking of the weekday cannot go to it.
func (e *correctionEval) target(name, day string) (carecontract.Offering, string) {
	offering, code := pickImportModule(e.school.offerings, name, e.day)
	switch {
	case code == carecontract.ContractImportProblemUnknown:
		return offering, carecontract.OfferingCorrectionProblemUnknown
	case code == carecontract.ContractImportProblemAmbiguous:
		return offering, carecontract.OfferingCorrectionProblemAmbiguous
	case code != "" || (offering.ServiceStart != nil && offering.ServiceStart.After(e.day)):
		return offering, carecontract.OfferingCorrectionProblemOutsidePhase
	case !offering.Active:
		return offering, carecontract.OfferingCorrectionProblemInactive
	case len(offering.AvailableDays) > 0 && !slices.Contains(offering.AvailableDays, day):
		return offering, carecontract.OfferingCorrectionProblemNotOffered
	}
	return offering, ""
}

// doubleBooked refuses a target the contract would book twice on a weekday:
// two bookings of one day cannot go to one module.
func (e *correctionEval) doubleBooked() {
	booked := map[string]bool{}
	for at, service := range e.services {
		key := service.Weekday + "\x1f" + service.CareOfferingID.String()
		if !booked[key] {
			booked[key] = true
			continue
		}
		line := e.replaced[at]
		if line == 0 {
			// The earlier of the two is the one a row moved.
			line = e.result.Line
			for other, earlier := range e.services[:at] {
				if earlier.Weekday == service.Weekday && earlier.CareOfferingID == service.CareOfferingID && e.replaced[other] != 0 {
					line = e.replaced[other]
				}
			}
		}
		e.problem(line, carecontract.OfferingCorrectionFieldTarget, carecontract.OfferingCorrectionProblemDoubleBooked)
	}
}

// settle names what the correction does with the contract and, for a ready
// one, makes its new version: the base with the corrected modules, from the
// day on.
func (e *correctionEval) settle(contract ports.CorrectableContract, base carecontract.Version) *ports.CorrectedVersion {
	changed := slices.ContainsFunc(e.replaced, func(line int) bool { return line != 0 })
	switch {
	case len(e.result.Problems) > 0:
		return nil
	case e.held:
		e.result.Status = carecontract.OfferingCorrectionHeld
		return nil
	case !changed:
		e.result.Status = carecontract.OfferingCorrectionUnchanged
		return nil
	}
	version := base
	version.ID, version.Number, version.EffectiveFrom = 0, contract.NextNumber, e.day
	version.Status, version.Source = carecontract.VersionEffective, carecontract.SourceOfferingCorrection
	version.ValidUntil, version.Services = nil, e.services
	sortServices(version.Services)
	version.PriceCents = e.singlePrice(version.Services)
	step := ports.VersionStep{Supersede: base.ID.Int64(), Status: carecontract.VersionEffective}
	if base.EffectiveFrom == e.day {
		step = ports.VersionStep{Replace: base.ID.Int64(), Status: base.Status}
	}
	day := e.day
	e.result.Status, e.result.EffectiveFrom, e.result.VersionNumber = carecontract.OfferingCorrectionReady, &day, version.Number
	return &ports.CorrectedVersion{ContractID: contract.ID, Step: step, Version: version}
}

// singlePrice is the price of the only module of the services, as every
// version keeps it (ADR 0088 section 2); nil for several modules or a module
// without a price.
func (e *correctionEval) singlePrice(services []carecontract.Service) *int64 {
	offerings := map[int64]carecontract.Offering{}
	for _, offering := range e.school.offerings {
		offerings[offering.ID] = offering
	}
	return singleModulePrice(schoolRead{offerings: offerings}, services)
}
