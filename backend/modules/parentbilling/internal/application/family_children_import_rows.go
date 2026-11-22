package application

import (
	"errors"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// Reading the rows of a file with the numbers of the families (#7356):
// every row becomes a candidate with the contracts of its child. Nothing
// here reads or writes.

const maxFamilyImportNameLength = 100

// familyImportFields are the fields in the order the suggestion gives a
// header away.
var familyImportFields = []string{
	parentbilling.FamilyImportFieldChildren, parentbilling.FamilyImportFieldChildFirstName, parentbilling.FamilyImportFieldChildLastName,
	parentbilling.FamilyImportFieldChildBirthDate, parentbilling.FamilyImportFieldSchool, parentbilling.FamilyImportFieldValidFrom,
}

// familyImportHeaderNames are the header names moto maps without help,
// after textnorm.HeaderKey folded them. OGS Connect calls the number
// "Anzahl der Kinder in der Familie unter 18 Jahren".
var familyImportHeaderNames = map[string][]string{
	parentbilling.FamilyImportFieldChildren: {"anzahlderkinderinderfamilieunter18jahren", "anzahlkinderinderfamilieunter18jahren",
		"anzahlderkinderinderfamilie", "anzahlkinderinderfamilie", "kinderinderfamilie", "anzahlkinderunter18", "anzahlderkinderunter18",
		"kinderunter18", "anzahlkinder", "anzahlderkinder", "kinderzahl", "kinderanzahl", "familienkinder", "familychildren"},
	parentbilling.FamilyImportFieldChildFirstName: {"vornamekind", "vornamedeskindes", "kindvorname", "vorname", "rufname", "firstname"},
	parentbilling.FamilyImportFieldChildLastName: {"nachnamekind", "nachnamedeskindes", "kindnachname", "nachname", "familienname",
		"name", "lastname"},
	parentbilling.FamilyImportFieldChildBirthDate: {"geburtsdatum", "geburtsdatumkind", "geburtsdatumdeskindes", "geburtstag", "gebdatum",
		"geborenam", "birthdate", "dateofbirth"},
	parentbilling.FamilyImportFieldSchool: {"schule", "schulname", "einrichtung", "standort", "betreuungsort", "ogs", "school"},
	// Only names that speak of the number: a plain „Gültig ab“ can be the
	// first day of the contract and a plain „Stichtag“ the day of a report,
	// and moto never dates a number by such a column by itself (#7765). The
	// office maps it on purpose.
	parentbilling.FamilyImportFieldValidFrom: {"kinderzahlgiltab", "kinderzahlgueltigab", "kinderzahlgueltigseit", "kinderzahlab",
		"kinderzahlstichtag", "stichtagkinderzahl"},
}

// familyImportIndex is a mapping resolved against a file: the position of
// each mapped column, the school of a file without that column and the day
// the numbers count from where a row names none.
type familyImportIndex struct {
	fields    map[string]int
	schoolID  int64
	validFrom calendar.Date
}

func (index familyImportIndex) has(field string) bool {
	_, ok := index.fields[field]
	return ok
}

func (index familyImportIndex) cell(cells []string, field string) string {
	position, ok := index.fields[field]
	if !ok || position >= len(cells) {
		return ""
	}
	return strings.TrimSpace(cells[position])
}

// unmapped names the required fields without a column or a choice.
func (index familyImportIndex) unmapped() []string {
	unmapped := []string{}
	for _, field := range []string{parentbilling.FamilyImportFieldChildFirstName, parentbilling.FamilyImportFieldChildLastName,
		parentbilling.FamilyImportFieldChildren} {
		if !index.has(field) {
			unmapped = append(unmapped, field)
		}
	}
	if !index.has(parentbilling.FamilyImportFieldSchool) && index.schoolID == 0 {
		unmapped = append(unmapped, parentbilling.FamilyImportFieldSchool)
	}
	return unmapped
}

// resolveFamilyImportMapping finds the column of each mapped field. A
// header the file does not have, a column used twice or a school that is
// not the Träger's refuses the mapping.
func resolveFamilyImportMapping(headers []string, mapping parentbilling.FamilyChildrenImportMapping, schools []parentbilling.CareSchool) (familyImportIndex, error) {
	columns := map[string]string{
		parentbilling.FamilyImportFieldChildFirstName: mapping.Columns.ChildFirstName,
		parentbilling.FamilyImportFieldChildLastName:  mapping.Columns.ChildLastName,
		parentbilling.FamilyImportFieldChildBirthDate: mapping.Columns.ChildBirthDate,
		parentbilling.FamilyImportFieldSchool:         mapping.Columns.School,
		parentbilling.FamilyImportFieldChildren:       mapping.Columns.Children,
		parentbilling.FamilyImportFieldValidFrom:      mapping.Columns.ValidFrom,
	}
	refused := validation.Errors{}
	index := familyImportIndex{fields: map[string]int{}, schoolID: mapping.SchoolID.Int64()}
	if mapping.ValidFrom == nil || !plausibleFamilyImportDay(*mapping.ValidFrom) {
		refused[parentbilling.FamilyImportFieldValidFrom] = errors.New("is no day the numbers can count from")
	} else {
		index.validFrom = *mapping.ValidFrom
	}
	used := map[string]bool{}
	for _, field := range familyImportFields {
		header := columns[field]
		if header == "" {
			continue
		}
		position := slices.Index(headers, header)
		switch {
		case position < 0:
			refused[field] = errors.New("names no column of the file")
		case used[header]:
			refused[field] = errors.New("names a column another field uses")
		default:
			index.fields[field], used[header] = position, true
		}
	}
	if mapping.SchoolID != 0 && !slices.ContainsFunc(schools, func(s parentbilling.CareSchool) bool { return s.ID == mapping.SchoolID }) {
		refused["school_id"] = errors.New("is no school of the Träger")
	}
	if len(refused) > 0 {
		return familyImportIndex{}, refused
	}
	return index, nil
}

// plausibleFamilyImportDay keeps a mistyped year out: a number of children
// under 18 counts from this century on and not beyond the next one.
func plausibleFamilyImportDay(day calendar.Date) bool {
	return !day.IsZero() && day.Year() >= 2000 && day.Year() < 2100
}

// familyImportContract is a contract a row can name: its child at its
// school as its newest version names it, and its first day.
type familyImportContract struct {
	id       int64
	schoolID int64
	name     string
	birth    *calendar.Date
	firstDay calendar.Date
	// inForce are the times the contract's versions are in force, one per
	// version; a version that runs on ends with the page's window. A time
	// between two versions is covered by none.
	inForce []familyImportSpan
}

// familyImportContracts are the contracts of the versions, each with the
// child of its newest version and its first day among them.
func familyImportContracts(versions []parentbilling.CareContractVersion) []familyImportContract {
	byContract, order := versionsByContract(versions)
	contracts := make([]familyImportContract, 0, len(order))
	for _, id := range order {
		list := byContract[id]
		newest, first := list[0], list[0].From
		inForce := make([]familyImportSpan, 0, len(list))
		for _, version := range list {
			if version.From.After(newest.From) {
				newest = version
			}
			if version.From.Before(first) {
				first = version.From
			}
			inForce = append(inForce, familyImportSpan{version.From, version.Until})
		}
		contracts = append(contracts, familyImportContract{id: id, schoolID: newest.SchoolID,
			name:  foldFamilyImportName(newest.ChildFirstName) + "\x1f" + foldFamilyImportName(newest.ChildLastName),
			birth: newest.ChildBirthDate, firstDay: first, inForce: inForce})
	}
	return contracts
}

// foldFamilyImportName compares names without case and repeated blanks.
func foldFamilyImportName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// familyImportTarget is a family a row's number goes to, by the contract
// of the row's child: the one that began first.
type familyImportTarget struct {
	family     string
	contractID int64
	firstDay   calendar.Date
	// inForce are the times the child's contracts of the family are in
	// force, one per version of a contract.
	inForce []familyImportSpan
}

// familyImportSpan is the time one version of a contract is in force, both
// days included.
type familyImportSpan struct{ from, until calendar.Date }

// covers tells whether a contract of the child is in force in the family
// on the day.
func (t familyImportTarget) covers(day calendar.Date) bool {
	return slices.ContainsFunc(t.inForce, func(span familyImportSpan) bool {
		return span.from != "" && span.until != "" && !day.Before(span.from) && !day.After(span.until)
	})
}

// familyImportCandidate is a row with the families its number goes to, the
// day it counts from and, once decided, what happens per family.
type familyImportCandidate struct {
	row       parentbilling.FamilyChildrenImportRow
	targets   []familyImportTarget
	validFrom calendar.Date
	decided   []importedChildren
	// speaksOnly marks a row held back only by its day: it takes over
	// nothing, but its number still speaks against the rows of its families.
	speaksOnly bool
}

// familyImportCheck reads rows against the schools and contracts of the
// Träger. It remembers the contracts earlier rows named.
type familyImportCheck struct {
	index      familyImportIndex
	schools    []parentbilling.CareSchool
	contracts  []familyImportContract
	recipients map[int64]parentbilling.CareRecipient
	named      map[int64]int
	// unnamed is set while a row is read that names its child for no later
	// row.
	unnamed bool
}

// problemOf notes what holds a row back: the field and the kind of problem.
func problemOf(row *parentbilling.FamilyChildrenImportRow, field, problem string) {
	row.Problems = append(row.Problems, parentbilling.FamilyChildrenImportProblem{Field: field, Code: problem})
}

// candidate reads one row.
func (c *familyImportCheck) candidate(cells []string, line int) familyImportCandidate {
	candidate := familyImportCandidate{row: parentbilling.FamilyChildrenImportRow{Line: line, Problems: []parentbilling.FamilyChildrenImportProblem{}}}
	row := &candidate.row
	row.ChildFirstName = c.name(row, cells, parentbilling.FamilyImportFieldChildFirstName)
	row.ChildLastName = c.name(row, cells, parentbilling.FamilyImportFieldChildLastName)
	if value := c.index.cell(cells, parentbilling.FamilyImportFieldChildBirthDate); value != "" {
		if date, ok := calendar.ParseFileDate(value); ok {
			row.ChildBirthDate = &date
		} else {
			problemOf(row, parentbilling.FamilyImportFieldChildBirthDate, parentbilling.FamilyImportProblemInvalid)
		}
	}
	row.Children = c.children(row, cells)
	candidate.validFrom = c.validFrom(row, cells)
	schoolID, hasSchool := c.school(row, cells)
	candidate.speaksOnly = hasSchool && onlyDayHoldsBack(row)
	if (len(row.Problems) > 0 && !candidate.speaksOnly) || !hasSchool {
		row.Status = parentbilling.FamilyImportInvalid
		return candidate
	}
	// A row held back by its day names its child for no later row: a
	// second row of the child with a sound day still counts.
	c.unnamed = candidate.speaksOnly
	candidate.targets = c.match(row, schoolID)
	c.unnamed = false
	if candidate.speaksOnly {
		row.Status = parentbilling.FamilyImportInvalid
	}
	return candidate
}

// onlyDayHoldsBack tells whether a row's one problem is its day. Its child
// and number are sound: without the day column the row would count, so its
// number must still speak against a sibling's row that names another one.
func onlyDayHoldsBack(row *parentbilling.FamilyChildrenImportRow) bool {
	return len(row.Problems) == 1 && row.Problems[0].Field == parentbilling.FamilyImportFieldValidFrom
}

// validFrom reads the day the row's number counts from: its own column,
// else the day of the file. A cell that is no day holds the row back, so a
// number never counts from a day the office did not mean.
func (c *familyImportCheck) validFrom(row *parentbilling.FamilyChildrenImportRow, cells []string) calendar.Date {
	value := c.index.cell(cells, parentbilling.FamilyImportFieldValidFrom)
	if value == "" {
		return c.index.validFrom
	}
	day, ok := calendar.ParseFileDate(value)
	if !ok || !plausibleFamilyImportDay(day) {
		problemOf(row, parentbilling.FamilyImportFieldValidFrom, parentbilling.FamilyImportProblemInvalid)
		return c.index.validFrom
	}
	return day
}

func (c *familyImportCheck) name(row *parentbilling.FamilyChildrenImportRow, cells []string, field string) string {
	value := strings.Join(strings.Fields(c.index.cell(cells, field)), " ")
	switch {
	case value == "":
		problemOf(row, field, parentbilling.FamilyImportProblemMissing)
	case utf8.RuneCountInString(value) > maxFamilyImportNameLength:
		problemOf(row, field, parentbilling.FamilyImportProblemTooLong)
		return ""
	}
	return value
}

// children reads the number: a whole number from 1 to MaxFamilyChildren.
func (c *familyImportCheck) children(row *parentbilling.FamilyChildrenImportRow, cells []string) *int {
	value := c.index.cell(cells, parentbilling.FamilyImportFieldChildren)
	if value == "" {
		problemOf(row, parentbilling.FamilyImportFieldChildren, parentbilling.FamilyImportProblemMissing)
		return nil
	}
	number, err := strconv.Atoi(value)
	if err != nil || validChildren(number) != nil {
		problemOf(row, parentbilling.FamilyImportFieldChildren, parentbilling.FamilyImportProblemInvalid)
		return nil
	}
	return &number
}

// school finds the school of the row: the chosen one, else the one the
// cell names without case and punctuation.
func (c *familyImportCheck) school(row *parentbilling.FamilyChildrenImportRow, cells []string) (int64, bool) {
	matches := func(school parentbilling.CareSchool) bool { return school.ID == ident.ID(c.index.schoolID) }
	if c.index.has(parentbilling.FamilyImportFieldSchool) {
		value := c.index.cell(cells, parentbilling.FamilyImportFieldSchool)
		row.SchoolName = value
		if value == "" {
			problemOf(row, parentbilling.FamilyImportFieldSchool, parentbilling.FamilyImportProblemMissing)
			return 0, false
		}
		matches = func(school parentbilling.CareSchool) bool {
			return textnorm.HeaderKey(school.Name) == textnorm.HeaderKey(value)
		}
	}
	var found []parentbilling.CareSchool
	for _, school := range c.schools {
		if matches(school) {
			found = append(found, school)
		}
	}
	switch len(found) {
	case 1:
		row.SchoolName = found[0].Name
		return found[0].ID.Int64(), true
	case 0:
		problemOf(row, parentbilling.FamilyImportFieldSchool, parentbilling.FamilyImportProblemUnknown)
	default:
		problemOf(row, parentbilling.FamilyImportFieldSchool, parentbilling.FamilyImportProblemAmbiguous)
	}
	return 0, false
}

// match finds the contracts of the row's child at the school: the same
// names, and no two different dates of birth. A missing date of birth
// cannot tell two children apart, so contracts with different dates of
// birth that all fit the row name no single child. A child an earlier row
// named is a conflict.
func (c *familyImportCheck) match(row *parentbilling.FamilyChildrenImportRow, schoolID int64) []familyImportTarget {
	name := foldFamilyImportName(row.ChildFirstName) + "\x1f" + foldFamilyImportName(row.ChildLastName)
	var found []familyImportContract
	births := map[calendar.Date]bool{}
	for _, contract := range c.contracts {
		if contract.schoolID != schoolID || contract.name != name ||
			(row.ChildBirthDate != nil && contract.birth != nil && *row.ChildBirthDate != *contract.birth) {
			continue
		}
		found = append(found, contract)
		if contract.birth != nil {
			births[*contract.birth] = true
		}
	}
	field := parentbilling.FamilyImportFieldChildLastName
	switch {
	case len(found) == 0:
		problemOf(row, field, parentbilling.FamilyImportProblemNoContract)
		row.Status = parentbilling.FamilyImportInvalid
		return nil
	case len(births) > 1:
		problemOf(row, field, parentbilling.FamilyImportProblemAmbiguous)
		row.Status = parentbilling.FamilyImportInvalid
		return nil
	}
	return c.targets(row, found)
}

// targets names the families of the child's contracts, each once. A child
// an earlier row named is a conflict; its row still names its families, so
// its number speaks against theirs.
func (c *familyImportCheck) targets(row *parentbilling.FamilyChildrenImportRow, found []familyImportContract) []familyImportTarget {
	if c.named == nil {
		c.named = map[int64]int{}
	}
	repeated := false
	for _, contract := range found {
		if line, named := c.named[contract.id]; named && !repeated {
			problemOf(row, parentbilling.FamilyImportFieldChildLastName, parentbilling.FamilyImportProblemRepeated)
			row.Status, row.RepeatsLine, repeated = parentbilling.FamilyImportConflict, line, true
		}
	}
	var targets []familyImportTarget
	for _, contract := range found {
		if !repeated && !c.unnamed {
			c.named[contract.id] = row.Line
		}
		family := parentbilling.ContractFamilyKey(c.recipients[contract.id].Email, contract.id)
		position := slices.IndexFunc(targets, func(target familyImportTarget) bool { return target.family == family })
		switch {
		case position < 0:
			targets = append(targets, familyImportTarget{family: family, contractID: contract.id, firstDay: contract.firstDay})
			position = len(targets) - 1
		case contract.firstDay.Before(targets[position].firstDay):
			targets[position].contractID, targets[position].firstDay = contract.id, contract.firstDay
		}
		targets[position].inForce = append(targets[position].inForce, contract.inForce...)
	}
	if !repeated {
		row.ContractID = ident.ID(targets[0].contractID)
	}
	return targets
}
