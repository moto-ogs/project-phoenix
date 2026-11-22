package application

import (
	"slices"
	"strconv"
	"strings"
	"unicode"
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

// namesPartyTwice tells whether the row names a person more often than the
// contract has parties of that name: the same words in any order, without
// case and with umlauts written out. Stored, the further name would be one
// person twice in the contract.
func namesPartyTwice(written, stored []ports.CorrectionParty) bool {
	key := func(party ports.CorrectionParty) string {
		words := nameWords(party.FirstName + " " + party.LastName)
		slices.Sort(words)
		return strings.Join(words, " ")
	}
	have := map[string]int{}
	for _, party := range stored {
		have[key(party)]++
	}
	named := map[string]int{}
	for _, party := range written {
		named[key(party)]++
		if named[key(party)] > max(1, have[key(party)]) {
			return true
		}
	}
	return false
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

// contractCorrectionCheck decides the rows of a file against the contracts they
// name.
type contractCorrectionCheck struct {
	subjects map[int64]ports.CorrectionSubject
	seen     map[int64]int
}

func newContractCorrectionCheck(subjects []ports.CorrectionSubject) *contractCorrectionCheck {
	check := &contractCorrectionCheck{subjects: make(map[int64]ports.CorrectionSubject, len(subjects)), seen: map[int64]int{}}
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
func (c *contractCorrectionCheck) plan(entry correctionEntry) correctionPlan {
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
func (c *contractCorrectionCheck) subject(entry *correctionEntry) (ports.CorrectionSubject, bool) {
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
	case entry.child != "" && !namesChild(entry.child, subject.ChildFirstName, subject.ChildLastName):
		entry.problem(carecontract.ContractCorrectionFieldChild, carecontract.ContractCorrectionProblemChildDiffers)
	}
	return subject, true
}

// namesChild tells whether a row names the child, without case. "Nachname,
// Vorname" names the last name before its last comma; without a comma the
// first and the last name stand in either order. The words of each keep
// their order, so "Anna Marie Weber" is not "Marie Anna Weber", and "Martin,
// Paul" is not the child Martin Paul.
func namesChild(written, first, last string) bool {
	fold := func(name string) string { return joinWords(strings.ToLower(name)) }
	if at := strings.LastIndex(written, ","); at >= 0 {
		return fold(written[:at]) == fold(last) && fold(written[at+1:]) == fold(first)
	}
	return fold(written) == fold(first+" "+last) || fold(written) == fold(last+" "+first)
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
// lacks is a further party or, for the one party left over, that party
// written anew. A row never removes a party. A cell the list to download
// wrote itself changes nothing, however its names read.
func planParties(entry correctionEntry, subject ports.CorrectionSubject, plan *correctionPlan) {
	if !entry.hasParties || joinWords(entry.partyCell) == joinWords(correctionPartyCell(subject.Parties)) {
		return
	}
	if namesPartyTwice(entry.parties, subject.Parties) {
		plan.problem(carecontract.ContractCorrectionFieldParties, carecontract.ContractCorrectionProblemPartyRepeated)
		return
	}
	written, stored, wanted := pairNamedParties(entry, subject.Parties)
	renames, adds, problem := matchCorrectionParties(stored, wanted)
	renames = append(written, renames...)
	if problem != "" {
		plan.problem(carecontract.ContractCorrectionFieldParties, problem)
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

// partyPairing pairs the names of a row with the parties of a contract:
// free are the parties no name found yet, claimed the names that found one.
type partyPairing struct {
	free    []ports.CorrectionParty
	claimed []bool
	renames []ports.CorrectionParty
}

// pair gives each name without a party the first free party match accepts,
// and keeps the party as match writes it when its spelling changes.
func (p *partyPairing) pair(match func(name int, party ports.CorrectionParty) (written ports.CorrectionParty, changed, ok bool)) {
	for n := range p.claimed {
		if p.claimed[n] {
			continue
		}
		for at, party := range p.free {
			written, changed, ok := match(n, party)
			if !ok {
				continue
			}
			if changed {
				written.ID = party.ID
				p.renames = append(p.renames, written)
			}
			p.claimed[n], p.free = true, slices.Delete(p.free, at, at+1)
			break
		}
	}
}

// pairNamedParties pairs each name of the row with the party of the
// contract that carries it. A name as the list to download writes a party is
// that party, read with the party's own boundary between last and first
// name: a stored name may carry a comma, which no other reading would keep.
// Then a name that reads the same in full is that party. Every name that is
// the same finds its party before any that differs only in case, which is
// the party written anew: so a row stored once reads back as unchanged. It
// answers the parties whose spelling changes and what is left of the
// contract's parties and of the row's names for the pairing by likeness.
func pairNamedParties(entry correctionEntry, stored []ports.CorrectionParty) (renames, leftStored, leftWanted []ports.CorrectionParty) {
	full := func(party ports.CorrectionParty) string {
		return fullName(joinWords(party.FirstName), joinWords(party.LastName))
	}
	pairing := partyPairing{free: slices.Clone(stored), claimed: make([]bool, len(entry.parties))}
	for step, same := range []func(a, b string) bool{func(a, b string) bool { return a == b }, strings.EqualFold} {
		pairing.pair(func(n int, party ports.CorrectionParty) (ports.CorrectionParty, bool, bool) {
			if !same(joinWords(correctionPartyCell([]ports.CorrectionParty{party})), entry.partyNames[n]) {
				return ports.CorrectionParty{}, false, false
			}
			written, changed := writtenParty(entry.partyNames[n], party)
			return written, changed, true
		})
		pairing.pair(func(n int, party ports.CorrectionParty) (ports.CorrectionParty, bool, bool) {
			return entry.parties[n], step > 0, same(full(entry.parties[n]), full(party))
		})
	}
	for n, party := range entry.parties {
		if !pairing.claimed[n] {
			leftWanted = append(leftWanted, party)
		}
	}
	return pairing.renames, pairing.free, leftWanted
}

// writtenParty is party with the name as the row writes it; changed tells
// that its spelling differs from the stored one.
func writtenParty(name string, party ports.CorrectionParty) (ports.CorrectionParty, bool) {
	written := withStoredBoundary(name, party)
	written.ID = party.ID
	return written, written.FirstName != joinWords(party.FirstName) || written.LastName != joinWords(party.LastName)
}

// withStoredBoundary splits a name written as the list to download writes
// party, in any case, where that party's last name ends: neither a last nor
// a first name with a comma of its own moves the boundary.
func withStoredBoundary(name string, party ports.CorrectionParty) ports.CorrectionParty {
	written, last := []rune(name), len([]rune(joinWords(party.LastName)))
	if party.FirstName == "" || last > len(written) {
		return ports.CorrectionParty{LastName: name}
	}
	return ports.CorrectionParty{LastName: string(written[:last]), FirstName: joinWords(strings.TrimPrefix(string(written[last:]), ","))}
}

// matchCorrectionParties decides what the names no party carries are. With
// every party named they are further parties. One party left over with one
// name left over is that party written anew, when the two share a word. A
// party keeps its address and its account, so nothing else is guessed: with
// more left over on either side, or no shared word, the row does not tell
// who is who, and the office changes one name per file. It answers the
// party whose name changes, the further parties and, when a party found no
// name, the problem.
func matchCorrectionParties(stored, wanted []ports.CorrectionParty) (renames, adds []ports.CorrectionParty, problem string) {
	switch {
	case len(stored) == 0:
		return nil, wanted, ""
	case len(wanted) == 0:
		return nil, nil, carecontract.ContractCorrectionProblemPartyRemoved
	case len(stored) > 1 || len(wanted) > 1 || !sharesNameWord(stored[0], wanted[0]):
		return nil, nil, carecontract.ContractCorrectionProblemPartyUnclear
	}
	return []ports.CorrectionParty{{ID: stored[0].ID, FirstName: wanted[0].FirstName, LastName: wanted[0].LastName}}, nil, ""
}

// sharesNameWord tells whether the party's name and the written name have a
// word in common.
func sharesNameWord(party, written ports.CorrectionParty) bool {
	has := nameWords(written.FirstName + " " + written.LastName)
	return slices.ContainsFunc(nameWords(party.FirstName+" "+party.LastName), func(word string) bool { return slices.Contains(has, word) })
}

var umlauts = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss")

// nameWords are the words of a name in lower case, with umlauts written
// out: "Müller-Roth" and "Mueller Roth" have the same words.
func nameWords(name string) []string {
	return strings.FieldsFunc(umlauts.Replace(strings.ToLower(name)), func(r rune) bool { return !unicode.IsLetter(r) })
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
