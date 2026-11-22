package application

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var correctionToday = calendar.NewDate(2026, 11, 22)

// correctionSubject is an imported contract of Lia with her mother as its
// only party, concluded on paper on a day the import assumed.
func correctionSubject() ports.CorrectionSubject {
	at := calendar.NewDate(2026, 8, 1).BerlinMidnight()
	return ports.CorrectionSubject{ContractID: 7, SchoolID: 1, SchoolName: "Grundschule Nord", ChildFirstName: "Lia",
		ChildLastName: "Beispiel", Imported: true, ConcludedAt: &at, Method: carecontract.MethodPaper,
		Parties: []ports.CorrectionParty{{ID: 70, FirstName: "Eva", LastName: "Beispiel"}}}
}

func planCorrection(t *testing.T, subject ports.CorrectionSubject, cells ...string) correctionPlan {
	t.Helper()
	headers := []string{"Vertrag-ID", "Kind", "Vertragsparteien", "Abschlussart", "Abschlussdatum", "Beleg"}
	index, missing := resolveCorrectionColumns(headers)
	require.Empty(t, missing)
	return newContractCorrectionCheck([]ports.CorrectionSubject{subject}).plan(readCorrectionEntry(index, cells, 2, correctionToday))
}

func correctionProblemCodes(row carecontract.ContractCorrectionRow) map[string]string {
	codes := map[string]string{}
	for _, problem := range row.Problems {
		codes[problem.Field] = problem.Code
	}
	return codes
}

func TestCorrectionSeparatesTheDayOfConclusionFromTheStartAndNeverGuessesIt(t *testing.T) {
	t.Parallel()
	known := planCorrection(t, correctionSubject(), "7", "Lia Beispiel", "", "online", "12.03.2026", "vertrag.pdf")
	require.Equal(t, carecontract.ContractCorrectionChange, known.row.Status, known.row.Problems)
	assert.Equal(t, []string{"method", "concluded_on"}, known.row.Changes)
	assert.Equal(t, calendar.NewDate(2026, 3, 12).BerlinMidnight(), known.correction.ConcludedAt)
	assert.Equal(t, carecontract.MethodElectronic, known.correction.Method)
	assert.False(t, known.correction.DateUnknown)

	unknown := planCorrection(t, correctionSubject(), "7", "Beispiel, Lia", "", "", "Unbekannt", "kein Datum im Vertrag")
	require.Equal(t, carecontract.ContractCorrectionChange, unknown.row.Status, unknown.row.Problems)
	assert.True(t, unknown.correction.DateUnknown)
	assert.Equal(t, *correctionSubject().ConcludedAt, unknown.correction.ConcludedAt, "the instant the takeover recorded stays; the mark says it is no date")
	assert.Nil(t, unknown.row.After.ConcludedOn)
	assert.True(t, unknown.row.After.DateUnknown)

	subject := correctionSubject()
	subject.DateUnknown = true
	again := planCorrection(t, subject, "7", "Lia Beispiel", "Beispiel, Eva", "papier", "unbekannt", "")
	assert.Equal(t, carecontract.ContractCorrectionUnchanged, again.row.Status, "a repeated row changes nothing and needs no proof")
	assert.False(t, again.correction.Conclusion)
}

func TestCorrectionAddsPartiesAndNeverRemovesOne(t *testing.T) {
	t.Parallel()
	added := planCorrection(t, correctionSubject(), "7", "Lia Beispiel", "Tom Beispiel; Beispiel, Eva", "", "", "vertrag.pdf")
	require.Equal(t, carecontract.ContractCorrectionChange, added.row.Status, added.row.Problems)
	assert.Empty(t, added.correction.Renames, "the party the contract has stays as it is, whatever its place in the file")
	assert.Equal(t, []ports.CorrectionParty{{FirstName: "Tom", LastName: "Beispiel"}}, added.correction.Adds)
	assert.Equal(t, []string{"Eva Beispiel", "Tom Beispiel"}, added.row.After.Parties)

	renamed := planCorrection(t, correctionSubject(), "7", "Lia Beispiel", "von der Heide, Eva Maria | Tom Beispiel", "", "", "vertrag.pdf")
	assert.Equal(t, []ports.CorrectionParty{{ID: 70, FirstName: "Eva Maria", LastName: "von der Heide"}}, renamed.correction.Renames)
	assert.Equal(t, []string{"Eva Maria von der Heide", "Tom Beispiel"}, renamed.row.After.Parties)

	two := correctionSubject()
	two.Parties = append(two.Parties, ports.CorrectionParty{ID: 71, FirstName: "Tom", LastName: "Beispiel"})
	removed := planCorrection(t, two, "7", "Lia Beispiel", "Eva Beispiel", "", "", "vertrag.pdf")
	assert.Equal(t, carecontract.ContractCorrectionInvalid, removed.row.Status)
	assert.Equal(t, map[string]string{"parties": "party_removed"}, correctionProblemCodes(removed.row))
	assert.Equal(t, removed.row.Before, removed.row.After, "an invalid row shows no change")

	recased := planCorrection(t, two, "7", "Lia Beispiel", "tom beispiel | Ute Beispiel | Eva Beispiel", "", "", "vertrag.pdf")
	assert.Equal(t, []ports.CorrectionParty{{ID: 71, FirstName: "tom", LastName: "beispiel"}}, recased.correction.Renames,
		"a name in another case is its own party written anew")
	assert.Equal(t, []ports.CorrectionParty{{FirstName: "Ute", LastName: "Beispiel"}}, recased.correction.Adds)

	// A name in another case finds its own party before the places decide:
	// the changed name goes to the other party, never onto the wrong row.
	crossed := planCorrection(t, two, "7", "Lia Beispiel", "tom beispiel | Beispiel, Eva-Maria", "", "", "vertrag.pdf")
	assert.ElementsMatch(t, []ports.CorrectionParty{{ID: 71, FirstName: "tom", LastName: "beispiel"},
		{ID: 70, FirstName: "Eva-Maria", LastName: "Beispiel"}}, crossed.correction.Renames)
	assert.Empty(t, crossed.correction.Adds)

	// A party keeps its address and its account, so the place in the row
	// never decides who it is: the new person written first is the further
	// party, and a name unlike the party is refused.
	old := correctionSubject()
	old.Parties = []ports.CorrectionParty{{ID: 70, FirstName: "Eva", LastName: "Mueller"}}
	first := planCorrection(t, old, "7", "Lia Beispiel", "Müller, Tom | Müller, Eva", "", "", "vertrag.pdf")
	require.Equal(t, carecontract.ContractCorrectionChange, first.row.Status, first.row.Problems)
	assert.Equal(t, []ports.CorrectionParty{{ID: 70, FirstName: "Eva", LastName: "Müller"}}, first.correction.Renames)
	assert.Equal(t, []ports.CorrectionParty{{FirstName: "Tom", LastName: "Müller"}}, first.correction.Adds)
	other := planCorrection(t, old, "7", "Lia Beispiel", "Anders, Tom", "", "", "vertrag.pdf")
	assert.Equal(t, map[string]string{"parties": "party_unclear"}, correctionProblemCodes(other.row))
	// The same row again changes nothing, whichever party a name went to.
	pair := correctionSubject()
	pair.Parties = []ports.CorrectionParty{{ID: 70, FirstName: "Eva", LastName: "Beispiel"}, {ID: 71, FirstName: "Eva", LastName: "Beispiel Roth"}}
	once := planCorrection(t, pair, "7", "Lia Beispiel", "Roth, Eva Beispiel | eva beispiel roth", "", "", "vertrag.pdf")
	for n := range pair.Parties {
		for _, rename := range once.correction.Renames {
			if rename.ID == pair.Parties[n].ID {
				pair.Parties[n] = rename
			}
		}
	}
	twice := planCorrection(t, pair, "7", "Lia Beispiel", "Roth, Eva Beispiel | eva beispiel roth", "", "", "vertrag.pdf")
	assert.Equal(t, carecontract.ContractCorrectionUnchanged, twice.row.Status, twice.correction.Renames)
	assert.True(t, namesChild("Weber, Anna Marie", "Anna Marie", "Weber"))
	assert.True(t, namesChild("anna marie weber", "Anna Marie", "Weber"))
	assert.False(t, namesChild("Marie Anna Weber", "Anna Marie", "Weber"), "the row names a sibling")
	either := planCorrection(t, old, "7", "Lia Beispiel", "Müller, Tom | Müller, Jan", "", "", "vertrag.pdf")
	assert.Equal(t, map[string]string{"parties": "party_unclear"}, correctionProblemCodes(either.row), "two names equally like the party")
}

func TestCorrectionNamesItsContractUnambiguously(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		cells    []string
		problems map[string]string
	}{
		"another child":  {[]string{"7", "Ole Anders", "", "online", "", "b"}, map[string]string{"child": "child_differs"}},
		"no child":       {[]string{"7", "", "", "online", "", "b"}, map[string]string{"child": "missing"}},
		"unknown number": {[]string{"8", "Lia Beispiel", "", "online", "", "b"}, map[string]string{"contract_id": "unknown"}},
		"no number":      {[]string{"x7", "Lia Beispiel", "", "online", "", "b"}, map[string]string{"contract_id": "invalid"}},
		"no proof":       {[]string{"7", "Lia Beispiel", "", "online", "", ""}, map[string]string{"evidence": "missing"}},
		"a future day":   {[]string{"7", "Lia Beispiel", "", "", "23.11.2026", "b"}, map[string]string{"concluded_on": "future"}},
		"no day":         {[]string{"7", "Lia Beispiel", "", "", "bald", "b"}, map[string]string{"concluded_on": "invalid"}},
		"no method":      {[]string{"7", "Lia Beispiel", "", "fax", "", "b"}, map[string]string{"method": "invalid"}},
		"a bare comma":   {[]string{"7", "Lia Beispiel", ", Eva", "", "", "b"}, map[string]string{"parties": "invalid"}},
	} {
		plan := planCorrection(t, correctionSubject(), c.cells...)
		assert.Equal(t, carecontract.ContractCorrectionInvalid, plan.row.Status, name)
		assert.Equal(t, c.problems, correctionProblemCodes(plan.row), name)
	}

	own := correctionSubject()
	own.Imported = false
	assert.Equal(t, map[string]string{"contract_id": "not_imported"},
		correctionProblemCodes(planCorrection(t, own, "7", "Lia Beispiel", "", "online", "", "b").row), "moto records the conclusion of its own contracts")

	ended := correctionSubject()
	received := calendar.NewDate(2026, 9, 30)
	ended.FirstNoticeOn = &received
	assert.Equal(t, map[string]string{"concluded_on": "after_notice"},
		correctionProblemCodes(planCorrection(t, ended, "7", "Lia Beispiel", "", "", "01.10.2026", "b").row))

	check := newContractCorrectionCheck([]ports.CorrectionSubject{correctionSubject()})
	index, _ := resolveCorrectionColumns([]string{"Moto-Vertrag-ID", "Kind", "Abschlussart", "Nachweis"})
	first := check.plan(readCorrectionEntry(index, []string{"7", "Lia Beispiel", "online", "b"}, 2, correctionToday))
	second := check.plan(readCorrectionEntry(index, []string{"7", "Lia Beispiel", "papier", "b"}, 3, correctionToday))
	assert.Equal(t, carecontract.ContractCorrectionChange, first.row.Status, "a worklist's own headers name the columns too")
	assert.Equal(t, map[string]string{"contract_id": "repeated"}, correctionProblemCodes(second.row))
	assert.Equal(t, 2, second.row.RepeatsLine)
}

func TestCorrectionSheetReadsBackAsUnchanged(t *testing.T) {
	t.Parallel()
	subject := correctionSubject()
	subject.Parties = append(subject.Parties, ports.CorrectionParty{ID: 71, LastName: "Anders"},
		ports.CorrectionParty{ID: 72, FirstName: "Jan Ole", LastName: "von der Heide"})
	// An import may have stored a last name with a comma, with or without a
	// first name: the list must read back as it was written.
	comma := correctionSubject()
	comma.ContractID = 10
	comma.Parties = []ports.CorrectionParty{{ID: 90, FirstName: "Eva", LastName: "Schmidt, geb. Müller"}, {ID: 91, LastName: "Roth, geb. Klein"}}
	unknown := correctionSubject()
	unknown.ContractID, unknown.DateUnknown, unknown.Method = 8, true, carecontract.MethodElectronic
	own := correctionSubject()
	own.ContractID, own.Imported = 9, false
	sheet := correctionSheet([]ports.CorrectionSubject{subject, unknown, own, comma})
	require.Len(t, sheet.Rows, 3, "only contracts from an import are listed")
	assert.Equal(t, []string{"7", "Grundschule Nord", "Lia Beispiel", "Beispiel, Eva | Anders | von der Heide, Jan Ole", "papier", "01.08.2026", ""}, sheet.Rows[0])
	assert.Equal(t, []string{"online", "unbekannt"}, sheet.Rows[1][4:6])

	// A further name beside the written ones adds a party and renames none.
	extended := planCorrection(t, comma, "10", "Lia Beispiel", sheet.Rows[2][3]+" | Neu, Anna", "", "", "vertrag.pdf")
	assert.Empty(t, extended.correction.Renames)
	assert.Equal(t, []ports.CorrectionParty{{FirstName: "Anna", LastName: "Neu"}}, extended.correction.Adds)

	// In another order and case the written name still is its own party:
	// its e-mail address never moves under another person's name.
	recased := planCorrection(t, comma, "10", "Lia Beispiel", "Neu, Anna | ROTH, geb. Klein | Schmidt, geb. Müller, Eva", "", "", "vertrag.pdf")
	assert.Equal(t, []ports.CorrectionParty{{ID: 91, LastName: "ROTH, geb. Klein"}}, recased.correction.Renames)
	assert.Equal(t, []ports.CorrectionParty{{FirstName: "Anna", LastName: "Neu"}}, recased.correction.Adds)

	// A first name with a comma keeps its boundary too.
	double := correctionSubject()
	double.Parties = []ports.CorrectionParty{{ID: 95, FirstName: "Eva, Maria", LastName: "Schmidt"}}
	beside := planCorrection(t, double, "7", "Lia Beispiel", "Neu, Anna | Schmidt, Eva, Maria", "", "", "vertrag.pdf")
	assert.Empty(t, beside.correction.Renames)
	assert.Equal(t, []ports.CorrectionParty{{FirstName: "Anna", LastName: "Neu"}}, beside.correction.Adds)
	shouted := planCorrection(t, double, "7", "Lia Beispiel", "Neu, Anna | SCHMIDT, Eva, Maria", "", "", "vertrag.pdf")
	assert.Equal(t, []ports.CorrectionParty{{ID: 95, FirstName: "Eva, Maria", LastName: "SCHMIDT"}}, shouted.correction.Renames)

	// Two parties whose names read alike once their commas are gone stay
	// apart: each written name belongs to the party the list wrote it for.
	alike := correctionSubject()
	alike.Parties = []ports.CorrectionParty{{ID: 96, FirstName: "Anna", LastName: "Schmidt, Eva Maria"},
		{ID: 97, FirstName: "Eva", LastName: "Maria, Anna Schmidt"}}
	apart := planCorrection(t, alike, "7", "Lia Beispiel", "SCHMIDT, Eva Maria, Anna | Maria, Anna Schmidt, Eva", "", "", "vertrag.pdf")
	assert.Equal(t, []ports.CorrectionParty{{ID: 96, FirstName: "Anna", LastName: "SCHMIDT, Eva Maria"}}, apart.correction.Renames)
	assert.Empty(t, apart.correction.Adds)

	index, missing := resolveCorrectionColumns(sheet.Headers)
	require.Empty(t, missing)
	check := newContractCorrectionCheck([]ports.CorrectionSubject{subject, unknown, comma})
	for n, cells := range sheet.Rows {
		plan := check.plan(readCorrectionEntry(index, cells, n+2, correctionToday))
		assert.Equal(t, carecontract.ContractCorrectionUnchanged, plan.row.Status, "%v: %v", cells, plan.row.Problems)
	}
}

// A contract from an import has no withdrawal period moto dates: neither
// the method a correction sets nor an unknown day opens one, so a
// correction changes no deadline (#7767).
func TestTakenOverContractHasNoWithdrawalPeriodUntilMotoProvidedTheNotice(t *testing.T) {
	t.Parallel()
	at := calendar.NewDate(2026, 8, 1).BerlinMidnight()
	online := &carecontract.Concluded{Method: carecontract.MethodElectronic, At: at, TakenOver: true}
	assert.Nil(t, withdrawalUntil(online, nil, nil))
	assert.False(t, hasWithdrawalPeriod(&carecontract.Concluded{Method: carecontract.MethodElectronic, At: at, TakenOver: true, DateUnknown: true}, nil))
	assert.NotNil(t, withdrawalUntil(&carecontract.Concluded{Method: carecontract.MethodElectronic, At: at}, nil, nil),
		"a contract moto concluded keeps its period")

	// Once moto provided the notice, an unknown day counts from the notice
	// alone.
	informed := time.Date(2026, 11, 2, 9, 0, 0, 0, calendar.Berlin)
	until := withdrawalUntil(&carecontract.Concluded{Method: carecontract.MethodElectronic, At: at, TakenOver: true, DateUnknown: true}, &informed, nil)
	require.NotNil(t, until)
	assert.Equal(t, calendar.NewDate(2026, 11, 16), *until)
	// A notice later than 12 months and 14 days after a corrected day still
	// opens its 14 days: the day from a file caps no period.
	late := time.Date(2027, 10, 1, 9, 0, 0, 0, calendar.Berlin)
	corrected := withdrawalUntil(&carecontract.Concluded{Method: carecontract.MethodElectronic, At: at, TakenOver: true}, &late, nil)
	require.NotNil(t, corrected)
	assert.Equal(t, calendar.NewDate(2027, 10, 15), *corrected, "a corrected day of the conclusion moves no period")
	_, known := conclusionDay(&carecontract.Concluded{At: at, DateUnknown: true})
	assert.False(t, known)
}

func TestImportLeavesTheDayOfConclusionUnknownWithoutOneInTheFile(t *testing.T) {
	t.Parallel()
	check := importCheckOf(t)
	candidate := check.candidate(importRow(nil), 2)
	require.Equal(t, carecontract.ContractImportReady, candidate.row.Status, candidate.row.Problems)
	assert.True(t, candidate.contract.ConclusionDateUnknown, "the first day of the contract is no day of its conclusion")
	assert.Equal(t, calendar.NewDate(2026, 8, 1).BerlinMidnight(), candidate.contract.ConcludedAt)
}
