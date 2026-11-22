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
	// original is the module of each service before the file; sources
	// tells per service that a row names it as its booking.
	original []int64
	sources  []bool
	// claimed tells per service that a row found it at its target already.
	claimed []bool
	// lastDay is the last day the version and the contract hold; nil when
	// both run open ended.
	lastDay *calendar.Date
	held    bool
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
		moves := eval.moves(group.rows)
		for _, move := range moves {
			eval.decide(move, moves)
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
	e.replaced, e.claimed = make([]int, len(e.services)), make([]bool, len(e.services))
	e.original = make([]int64, len(e.services))
	for n, service := range e.services {
		e.original[n] = service.CareOfferingID.Int64()
	}
	e.lastDay = earlierDay(base.EndsOn, contract.EndsOn)
	return base, true
}

// correctionMove is one weekday of one row: the booking it names, found
// among the bookings the contract has before the file, and its target.
type correctionMove struct {
	row correctionRow
	day string
	// at is the booking the row names; -1 when the contract books no such
	// module on the weekday.
	at     int
	target carecontract.Offering
	// code is why the booking cannot go to the target; empty when it can.
	code string
}

// moves reads every weekday of every row against the bookings the contract
// has before the file. No row sees what another row does: a booking is the
// source of at most one row.
func (e *correctionEval) moves(rows []correctionRow) []correctionMove {
	moves := []correctionMove{}
	taken := make([]bool, len(e.services))
	for _, row := range rows {
		if !row.daysOK {
			e.problem(row.line, carecontract.OfferingCorrectionFieldWeekday, carecontract.OfferingCorrectionProblemInvalid)
		}
		if row.current == "" {
			e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemMissing)
		}
		if !row.daysOK || row.current == "" {
			continue
		}
		for _, day := range row.days {
			if move, ok := e.move(row, day, taken); ok {
				moves = append(moves, move)
			}
		}
	}
	e.sources = taken
	return moves
}

// move reads one weekday of a row; false for a booking another row names
// already.
func (e *correctionEval) move(row correctionRow, day string, taken []bool) (correctionMove, bool) {
	key := day + "\x1f" + textnorm.HeaderKey(row.current)
	if e.seen[key] {
		e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemRepeated)
		return correctionMove{}, false
	}
	e.seen[key] = true
	move := correctionMove{row: row, day: day, at: e.source(day, row.current, taken)}
	if move.at >= 0 {
		taken[move.at] = true
	}
	if row.target != "" {
		move.target, move.code = e.target(row.target, day)
	}
	return move, true
}

// source finds the booking of the weekday a row names: by the name the
// contract keeps for its module, or by the name the module has today, so a
// module the Träger renamed since the import is still found.
func (e *correctionEval) source(day, name string, taken []bool) int {
	key := textnorm.HeaderKey(name)
	return e.find(day, func(n int, s carecontract.Service) bool {
		if taken[n] {
			return false
		}
		return textnorm.HeaderKey(s.ModuleName) == key || textnorm.HeaderKey(e.offeringName(s.CareOfferingID.Int64())) == key
	})
}

func (e *correctionEval) offeringName(id int64) string {
	for _, offering := range e.school.offerings {
		if offering.ID == id {
			return offering.Name
		}
	}
	return ""
}

// overlapping tells that the move hands a module on or swaps two: its
// target is the module of a booking another row moves, or its own booking
// has the module another row moves a booking to. A repeated run would move
// such bookings again, so the file is refused in any order of its rows.
func (e *correctionEval) overlapping(move correctionMove, moves []correctionMove) bool {
	for _, other := range moves {
		if other.row.line == move.row.line && other.day == move.day || other.day != move.day {
			continue
		}
		if other.at >= 0 && e.original[other.at] == move.target.ID {
			return true
		}
		if move.at >= 0 && other.row.target != "" && other.code == "" && e.original[move.at] == other.target.ID {
			return true
		}
	}
	return false
}

// decide settles one move, knowing every move of the contract.
func (e *correctionEval) decide(move correctionMove, moves []correctionMove) {
	row, day, at := move.row, move.day, move.at
	if row.target == "" {
		e.heldBooking(row, day, at)
		return
	}
	if move.code != "" {
		e.problem(row.line, carecontract.OfferingCorrectionFieldTarget, move.code)
		return
	}
	if e.overlapping(move, moves) {
		e.problem(row.line, carecontract.OfferingCorrectionFieldTarget, carecontract.OfferingCorrectionProblemOverlapping)
		return
	}
	if at < 0 {
		e.alreadyMoved(row, day, move.target)
		return
	}
	service := e.services[at]
	if service.CareOfferingID.Int64() == move.target.ID {
		return
	}
	if !e.covers(move.target, service) {
		e.problem(row.line, carecontract.OfferingCorrectionFieldTarget, carecontract.OfferingCorrectionProblemOutsidePhase)
		return
	}
	if end := move.target.EndTimes[day]; end != "" && service.EndsAt != "" && end != service.EndsAt {
		e.hint(carecontract.OfferingCorrectionHintEndTimeDiffers)
	}
	e.change(day, service.ModuleName, move.target.Name)
	e.services[at].CareOfferingID, e.services[at].ModuleName = ident.ID(move.target.ID), move.target.Name
	e.replaced[at] = row.line
}

// find is the first service of the weekday the test holds for; -1 without
// one.
func (e *correctionEval) find(day string, test func(n int, s carecontract.Service) bool) int {
	for n, service := range e.services {
		if service.Weekday == day && test(n, service) {
			return n
		}
	}
	return -1
}

// alreadyMoved settles a row whose module the contract does not book on the
// weekday: a booking that names the target already is done, so a repeated
// run changes nothing. Only a booking the contract had before the file,
// that no row names as its own and no other row counted, is such a booking.
func (e *correctionEval) alreadyMoved(row correctionRow, day string, target carecontract.Offering) {
	at := e.find(day, func(n int, _ carecontract.Service) bool {
		return !e.sources[n] && !e.claimed[n] && e.original[n] == target.ID
	})
	if at < 0 {
		e.problem(row.line, carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionProblemNotBooked)
		return
	}
	e.claimed[at] = true
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

// covers tells that the phase of the target runs as long as the booking
// does: the booking keeps its last day, and the contract never books a
// module beyond its phase.
func (e *correctionEval) covers(target carecontract.Offering, service carecontract.Service) bool {
	if target.ServiceEnd == nil {
		return true
	}
	last := earlierDay(service.LastDay, e.lastDay)
	return last != nil && !last.After(*target.ServiceEnd)
}

// earlierDay is the earlier of two optional days; nil when both are open.
func earlierDay(a, b *calendar.Date) *calendar.Date {
	if a == nil || (b != nil && b.Before(*a)) {
		return b
	}
	return a
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
