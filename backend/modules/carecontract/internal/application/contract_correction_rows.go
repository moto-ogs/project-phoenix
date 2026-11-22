package application

import (
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The rows of a correction file (#7767). Reading a row and deciding what it
// changes are pure: the file and the contracts of the Träger decide, so the
// preview and the correction answer alike.

// correctionColumn is a column of a correction file: the header the list to
// download gives it and the further headers a file may carry for it, such as
// those of a worklist kept beside the migration.
type correctionColumn struct {
	field    string
	header   string
	aliases  []string
	required bool
}

// correctionColumns are the columns in the order of the list to download.
// The school is there for the reader only; a correction never reads it.
var correctionColumns = []correctionColumn{
	{field: carecontract.ContractCorrectionFieldContract, header: "Vertrag-ID", required: true,
		aliases: []string{"Moto-Vertrag-ID", "Vertragsnummer", "Vertrag"}},
	{field: "school", header: "Schule"},
	{field: carecontract.ContractCorrectionFieldChild, header: "Kind", required: true},
	{field: carecontract.ContractCorrectionFieldParties, header: "Vertragsparteien"},
	{field: carecontract.ContractCorrectionFieldMethod, header: "Abschlussart"},
	{field: carecontract.ContractCorrectionFieldConcludedOn, header: "Abschlussdatum"},
	{field: carecontract.ContractCorrectionFieldEvidence, header: "Beleg", required: true, aliases: []string{"Nachweis"}},
}

// The words a correction file writes for the values that are no date and no
// name; the list to download writes the first of each.
const (
	correctionWordOnline  = "online"
	correctionWordPaper   = "papier"
	correctionWordUnknown = "unbekannt"
	correctionPartyJoin   = " | "
)

var (
	correctionMethods = map[string]string{
		"online": carecontract.MethodElectronic, "elektronisch": carecontract.MethodElectronic,
		"einfachelektronisch": carecontract.MethodElectronic, "onlineanmeldung": carecontract.MethodElectronic,
		"papier": carecontract.MethodPaper, "papiervertrag": carecontract.MethodPaper, "schriftlich": carecontract.MethodPaper,
	}
	correctionUnknownDates = []string{"unbekannt", "nichtbelegt", "unknown"}
)

// maxCorrectionNameLength bounds the name of one party.
const maxCorrectionNameLength = 200

// correctionIndex maps each column of a correction to its position in the
// file.
type correctionIndex map[string]int

// resolveCorrectionColumns finds the columns of the file by their headers,
// without case and punctuation, and names the required ones it lacks.
func resolveCorrectionColumns(headers []string) (correctionIndex, []string) {
	index, missing := correctionIndex{}, []string{}
	for _, column := range correctionColumns {
		names := append([]string{column.header}, column.aliases...)
		position := slices.IndexFunc(headers, func(header string) bool {
			return slices.ContainsFunc(names, func(name string) bool { return textnorm.HeaderKey(name) == textnorm.HeaderKey(header) })
		})
		switch {
		case position >= 0:
			index[column.field] = position
		case column.required:
			missing = append(missing, column.field)
		}
	}
	return index, missing
}

func (i correctionIndex) cell(cells []string, field string) string {
	position, ok := i[field]
	if !ok || position >= len(cells) {
		return ""
	}
	return strings.TrimSpace(cells[position])
}

// correctionEntry is one row as the file writes it: the contract it names
// and the values it wants, each nil where the row leaves the value alone.
type correctionEntry struct {
	row        carecontract.ContractCorrectionRow
	contractID int64
	child      string
	parties    []ports.CorrectionParty
	hasParties bool
	// partyCell is the cell of the parties as the file writes it, partyNames
	// the name of each party in it.
	partyCell  string
	partyNames []string
	method     string
	// date is the day of the conclusion the row names; unknown that it names
	// none on purpose. Neither leaves the day alone.
	date    *calendar.Date
	unknown bool
}

func (e *correctionEntry) problem(field, code string) {
	e.row.Problems = append(e.row.Problems, carecontract.ContractCorrectionProblem{Field: field, Code: code})
}

// readCorrectionEntry reads one row of the file.
func readCorrectionEntry(index correctionIndex, cells []string, line int, today calendar.Date) correctionEntry {
	entry := correctionEntry{row: carecontract.ContractCorrectionRow{Line: line, Changes: []string{},
		Problems: []carecontract.ContractCorrectionProblem{},
		Before:   carecontract.ContractCorrectionValues{Parties: []string{}}, After: carecontract.ContractCorrectionValues{Parties: []string{}}}}
	entry.child = index.cell(cells, carecontract.ContractCorrectionFieldChild)
	entry.row.ChildName = entry.child
	entry.readContract(index.cell(cells, carecontract.ContractCorrectionFieldContract))
	if entry.child == "" {
		entry.problem(carecontract.ContractCorrectionFieldChild, carecontract.ContractCorrectionProblemMissing)
	}
	entry.readParties(index.cell(cells, carecontract.ContractCorrectionFieldParties))
	entry.readMethod(index.cell(cells, carecontract.ContractCorrectionFieldMethod))
	entry.readDate(index.cell(cells, carecontract.ContractCorrectionFieldConcludedOn), today)
	entry.row.Evidence = index.cell(cells, carecontract.ContractCorrectionFieldEvidence)
	if utf8.RuneCountInString(entry.row.Evidence) > carecontract.MaxContractCorrectionEvidence {
		entry.problem(carecontract.ContractCorrectionFieldEvidence, carecontract.ContractCorrectionProblemTooLong)
	}
	return entry
}

func (e *correctionEntry) readContract(value string) {
	if value == "" {
		e.problem(carecontract.ContractCorrectionFieldContract, carecontract.ContractCorrectionProblemMissing)
		return
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		e.problem(carecontract.ContractCorrectionFieldContract, carecontract.ContractCorrectionProblemInvalid)
		return
	}
	e.contractID, e.row.ContractID = id, ident.ID(id)
}

// readParties reads the parties of the cell: names separated by "|", ";" or
// a line break, each "Nachname, Vorname" or "Vorname Nachname".
func (e *correctionEntry) readParties(value string) {
	if value == "" {
		return
	}
	e.hasParties, e.partyCell = true, value
	for _, name := range strings.FieldsFunc(value, func(r rune) bool { return r == '|' || r == ';' || r == '\n' || r == '\r' }) {
		if strings.TrimSpace(name) == "" {
			continue
		}
		party, ok := correctionPartyOf(name)
		if !ok {
			e.problem(carecontract.ContractCorrectionFieldParties, carecontract.ContractCorrectionProblemInvalid)
			return
		}
		if utf8.RuneCountInString(party.FirstName)+utf8.RuneCountInString(party.LastName) > maxCorrectionNameLength {
			e.problem(carecontract.ContractCorrectionFieldParties, carecontract.ContractCorrectionProblemTooLong)
			return
		}
		e.parties, e.partyNames = append(e.parties, party), append(e.partyNames, joinWords(name))
	}
	switch {
	case len(e.parties) == 0:
		e.problem(carecontract.ContractCorrectionFieldParties, carecontract.ContractCorrectionProblemInvalid)
	case len(e.parties) > carecontract.MaxContractCorrectionParties:
		e.problem(carecontract.ContractCorrectionFieldParties, carecontract.ContractCorrectionProblemTooLong)
	}
}

// correctionPartyOf splits a name: "Nachname, Vorname" at its last comma,
// so a last name may carry one ("Schmidt, geb. Müller, Eva"); without a
// comma the last word is the last name. A name needs a last name.
func correctionPartyOf(name string) (ports.CorrectionParty, bool) {
	if at := strings.LastIndex(name, ","); at >= 0 {
		party := ports.CorrectionParty{FirstName: joinWords(name[at+1:]), LastName: joinWords(name[:at])}
		return party, party.LastName != ""
	}
	words := strings.Fields(name)
	if len(words) == 0 {
		return ports.CorrectionParty{}, false
	}
	return ports.CorrectionParty{FirstName: strings.Join(words[:len(words)-1], " "), LastName: words[len(words)-1]}, true
}

func joinWords(value string) string { return strings.Join(strings.Fields(value), " ") }

func (e *correctionEntry) readMethod(value string) {
	if value == "" {
		return
	}
	method, ok := correctionMethods[textnorm.HeaderKey(value)]
	if !ok {
		e.problem(carecontract.ContractCorrectionFieldMethod, carecontract.ContractCorrectionProblemInvalid)
		return
	}
	e.method = method
}

func (e *correctionEntry) readDate(value string, today calendar.Date) {
	if value == "" {
		return
	}
	if slices.Contains(correctionUnknownDates, textnorm.HeaderKey(value)) {
		e.unknown = true
		return
	}
	date, ok := calendar.ParseFileDate(value)
	switch {
	case !ok || date.Before(earliestImportDay):
		e.problem(carecontract.ContractCorrectionFieldConcludedOn, carecontract.ContractCorrectionProblemInvalid)
	case date.After(today):
		e.problem(carecontract.ContractCorrectionFieldConcludedOn, carecontract.ContractCorrectionProblemFuture)
	default:
		e.date = &date
	}
}

// correctionValuesOf are the values of a contract as a correction shows
// them.
func correctionValuesOf(subject ports.CorrectionSubject) carecontract.ContractCorrectionValues {
	values := carecontract.ContractCorrectionValues{Parties: make([]string, len(subject.Parties)), Method: subject.Method,
		DateUnknown: subject.DateUnknown}
	for n, party := range subject.Parties {
		values.Parties[n] = fullName(party.FirstName, party.LastName)
	}
	if subject.ConcludedAt != nil && !subject.DateUnknown {
		day := calendar.DateFromTime(*subject.ConcludedAt)
		values.ConcludedOn = &day
	}
	return values
}

// correctionPlan is a row with what it stores.
type correctionPlan struct {
	row        carecontract.ContractCorrectionRow
	schoolID   int64
	correction ports.Correction
}

// correctionCheck decides the rows of a file against the contracts they
// name.
type correctionCheck struct {
	subjects map[int64]ports.CorrectionSubject
	seen     map[int64]int
}

func newCorrectionCheck(subjects []ports.CorrectionSubject) *correctionCheck {
	check := &correctionCheck{subjects: make(map[int64]ports.CorrectionSubject, len(subjects)), seen: map[int64]int{}}
	for _, subject := range subjects {
		check.subjects[subject.ContractID] = subject
	}
	return check
}

func (p *correctionPlan) problem(field, code string) {
	p.row.Problems = append(p.row.Problems, carecontract.ContractCorrectionProblem{Field: field, Code: code})
}

// plan decides one row: a problem makes it invalid, values the contract has
// already leave it unchanged, else it changes the contract.
func (c *correctionCheck) plan(entry correctionEntry) correctionPlan {
	subject, found := c.subject(&entry)
	plan := correctionPlan{row: entry.row}
	row := &plan.row
	if found {
		plan.schoolID, row.SchoolName = subject.SchoolID, subject.SchoolName
		row.ChildName = fullName(subject.ChildFirstName, subject.ChildLastName)
		row.Before, row.After = correctionValuesOf(subject), correctionValuesOf(subject)
		plan.correction = ports.Correction{ContractID: subject.ContractID}
		if len(row.Problems) == 0 {
			planConclusion(entry, subject, &plan)
			planParties(entry, subject, &plan)
		}
	}
	if len(row.Problems) == 0 && len(row.Changes) > 0 && row.Evidence == "" {
		plan.problem(carecontract.ContractCorrectionFieldEvidence, carecontract.ContractCorrectionProblemMissing)
	}
	switch {
	case len(row.Problems) > 0:
		row.Status, row.Changes, row.After = carecontract.ContractCorrectionInvalid, []string{}, row.Before
	case len(row.Changes) == 0:
		row.Status = carecontract.ContractCorrectionUnchanged
	default:
		row.Status = carecontract.ContractCorrectionChange
	}
	return plan
}

// subject finds the contract of a row: one of the Träger, from an import,
// with the child the row names, and named by no row before.
func (c *correctionCheck) subject(entry *correctionEntry) (ports.CorrectionSubject, bool) {
	if entry.contractID == 0 {
		return ports.CorrectionSubject{}, false
	}
	subject, ok := c.subjects[entry.contractID]
	if !ok {
		entry.problem(carecontract.ContractCorrectionFieldContract, carecontract.ContractCorrectionProblemUnknown)
		return ports.CorrectionSubject{}, false
	}
	if first, repeated := c.seen[entry.contractID]; repeated {
		entry.problem(carecontract.ContractCorrectionFieldContract, carecontract.ContractCorrectionProblemRepeated)
		entry.row.RepeatsLine = first
	} else {
		c.seen[entry.contractID] = entry.row.Line
	}
	switch {
	case !subject.Imported || subject.ConcludedAt == nil:
		entry.problem(carecontract.ContractCorrectionFieldContract, carecontract.ContractCorrectionProblemNotImported)
	case entry.child != "" && nameKey(entry.child) != nameKey(subject.ChildFirstName+" "+subject.ChildLastName):
		entry.problem(carecontract.ContractCorrectionFieldChild, carecontract.ContractCorrectionProblemChildDiffers)
	}
	return subject, true
}

// nameKey folds a name for a comparison: its words without case and commas,
// in any order, so "Beispiel, Lia" names the child "Lia Beispiel".
func nameKey(name string) string {
	words := strings.Fields(strings.ToLower(strings.ReplaceAll(name, ",", " ")))
	slices.Sort(words)
	return strings.Join(words, " ")
}

// planConclusion plans the method and the day of the conclusion.
func planConclusion(entry correctionEntry, subject ports.CorrectionSubject, plan *correctionPlan) {
	row, correction := &plan.row, &plan.correction
	correction.ConcludedAt, correction.Method, correction.DateUnknown = *subject.ConcludedAt, subject.Method, subject.DateUnknown
	if entry.method != "" && entry.method != subject.Method {
		correction.Method, row.After.Method = entry.method, entry.method
		row.Changes = append(row.Changes, carecontract.ContractCorrectionFieldMethod)
	}
	switch {
	case entry.unknown && !subject.DateUnknown:
		correction.DateUnknown, row.After.DateUnknown, row.After.ConcludedOn = true, true, nil
		row.Changes = append(row.Changes, carecontract.ContractCorrectionFieldConcludedOn)
	case entry.date == nil || (row.Before.ConcludedOn != nil && *row.Before.ConcludedOn == *entry.date):
	case subject.FirstNoticeOn != nil && entry.date.After(*subject.FirstNoticeOn):
		plan.problem(carecontract.ContractCorrectionFieldConcludedOn, carecontract.ContractCorrectionProblemAfterNotice)
	default:
		correction.ConcludedAt, correction.DateUnknown = entry.date.BerlinMidnight(), false
		row.After.DateUnknown, row.After.ConcludedOn = false, entry.date
		row.Changes = append(row.Changes, carecontract.ContractCorrectionFieldConcludedOn)
	}
	correction.Conclusion = len(row.Changes) > 0
}

// planParties plans the parties: a name the contract has stays, a name it
// lacks corrects the party left over at its place or, with none left, is a
// further party. A row never removes a party. A cell the list to download
// wrote itself changes nothing, however its names read.
func planParties(entry correctionEntry, subject ports.CorrectionSubject, plan *correctionPlan) {
	if !entry.hasParties || joinWords(entry.partyCell) == joinWords(correctionPartyCell(subject.Parties)) {
		return
	}
	renames, adds, complete := matchCorrectionParties(subject.Parties, writtenCorrectionParties(entry, subject.Parties))
	if !complete {
		plan.problem(carecontract.ContractCorrectionFieldParties, carecontract.ContractCorrectionProblemPartyRemoved)
		return
	}
	if len(renames)+len(adds) == 0 {
		return
	}
	plan.correction.Renames, plan.correction.Adds = renames, adds
	names := map[int64]string{}
	for _, rename := range renames {
		names[rename.ID] = fullName(rename.FirstName, rename.LastName)
	}
	after := make([]string, 0, len(subject.Parties)+len(adds))
	for _, party := range subject.Parties {
		name, renamed := names[party.ID]
		if !renamed {
			name = fullName(party.FirstName, party.LastName)
		}
		after = append(after, name)
	}
	for _, add := range adds {
		after = append(after, fullName(add.FirstName, add.LastName))
	}
	plan.row.After.Parties = after
	plan.row.Changes = append(plan.row.Changes, carecontract.ContractCorrectionFieldParties)
}

// writtenCorrectionParties are the parties of the row, each name the list to
// download wrote for a party of the contract read with that party's own
// boundary between last and first name: a stored last name may carry a
// comma, which no other reading would keep. A name written as the list
// writes it is that party; one that differs only in case keeps its new
// spelling and the party's boundary, so it pairs with its own party.
func writtenCorrectionParties(entry correctionEntry, stored []ports.CorrectionParty) []ports.CorrectionParty {
	wanted, free := slices.Clone(entry.parties), slices.Clone(stored)
	claimed := make([]bool, len(wanted))
	for _, same := range []func(a, b string) bool{func(a, b string) bool { return a == b }, strings.EqualFold} {
		for n, name := range entry.partyNames {
			if claimed[n] {
				continue
			}
			at := slices.IndexFunc(free, func(party ports.CorrectionParty) bool {
				return same(joinWords(correctionPartyCell([]ports.CorrectionParty{party})), name)
			})
			if at < 0 {
				continue
			}
			if free[at].FirstName == "" {
				wanted[n] = ports.CorrectionParty{LastName: name}
			}
			claimed[n], free = true, slices.Delete(free, at, at+1)
		}
	}
	return wanted
}

// matchCorrectionParties pairs the parties of the contract with the names of
// the row: first every name that is the same, then every name that differs
// only in case, which is the same person written anew, and last the names
// left over by their place. It answers the parties whose name changes, the
// further parties and whether every party of the contract found a name.
func matchCorrectionParties(stored, wanted []ports.CorrectionParty) (renames, adds []ports.CorrectionParty, complete bool) {
	name := func(party ports.CorrectionParty) string {
		return fullName(joinWords(party.FirstName), joinWords(party.LastName))
	}
	stored, wanted = slices.Clone(stored), slices.Clone(wanted)
	pair := func(same func(a, b string) bool, rename bool) {
		for n := 0; n < len(stored); n++ {
			at := slices.IndexFunc(wanted, func(party ports.CorrectionParty) bool { return same(name(party), name(stored[n])) })
			if at < 0 {
				continue
			}
			if rename {
				renames = append(renames, ports.CorrectionParty{ID: stored[n].ID, FirstName: wanted[at].FirstName, LastName: wanted[at].LastName})
			}
			stored, wanted = slices.Delete(stored, n, n+1), slices.Delete(wanted, at, at+1)
			n--
		}
	}
	pair(func(a, b string) bool { return a == b }, false)
	pair(strings.EqualFold, true)
	if len(stored) > len(wanted) {
		return nil, nil, false
	}
	for n, party := range stored {
		renames = append(renames, ports.CorrectionParty{ID: party.ID, FirstName: wanted[n].FirstName, LastName: wanted[n].LastName})
	}
	return renames, wanted[len(stored):], true
}

// correctionPartyCell writes the parties as the list to download does:
// "Nachname, Vorname", separated by " | ".
func correctionPartyCell(parties []ports.CorrectionParty) string {
	names := make([]string, len(parties))
	for n, party := range parties {
		names[n] = party.LastName
		if party.FirstName != "" {
			names[n] += ", " + party.FirstName
		}
	}
	return strings.Join(names, correctionPartyJoin)
}

// correctionSheet is the list to download: every contract from an import
// under the headers a correction file reads, with the values a correction
// reads back as unchanged.
func correctionSheet(subjects []ports.CorrectionSubject) carecontract.ContractCorrectionSheet {
	sheet := carecontract.ContractCorrectionSheet{Headers: make([]string, len(correctionColumns)), Rows: make([][]string, 0, len(subjects))}
	for n, column := range correctionColumns {
		sheet.Headers[n] = column.header
	}
	for _, subject := range subjects {
		if !subject.Imported || subject.ConcludedAt == nil {
			continue
		}
		method := correctionWordPaper
		if subject.Method != carecontract.MethodPaper {
			method = correctionWordOnline
		}
		concluded := correctionWordUnknown
		if !subject.DateUnknown {
			concluded = calendar.DateFromTime(*subject.ConcludedAt).Format("02.01.2006")
		}
		sheet.Rows = append(sheet.Rows, []string{strconv.FormatInt(subject.ContractID, 10), subject.SchoolName,
			fullName(subject.ChildFirstName, subject.ChildLastName), correctionPartyCell(subject.Parties), method, concluded, ""})
	}
	return sheet
}
