package application

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The identifiers of the decision tests: two schools of the Träger, the
// child records each has and the contracts the Träger has. A contract of
// another Träger never reaches the decision: ContractChildren reads only the
// Träger's own, so it is an unknown identifier.
const (
	linkSchoolNorth, linkSchoolSouth   = 31, 32
	linkMia, linkBen, linkLea, linkOla = 501, 502, 503, 504
	linkStrangerAtSouth                = 601
)

var linkToday = calendar.NewDate(2026, 11, 22)

func linkPtr(id int64) *int64 { return &id }

func linkContractsFixture() []ports.ContractChild {
	return []ports.ContractChild{
		// 11 is imported, unlinked, Mia's copy.
		{ContractID: 11, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Mia", LastName: "Beispiel",
			BirthDate: importDay(2018, 3, 4), StartsOn: calendar.NewDate(2026, 8, 1), ImportOrigin: "mia"},
		// 12 is from an application.
		{ContractID: 12, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Ben", LastName: "Muster",
			StartsOn: calendar.NewDate(2026, 8, 1), StudentID: linkPtr(linkBen)},
		// 13 is imported and linked to Lea already.
		{ContractID: 13, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Lea", LastName: "Probe",
			StartsOn: calendar.NewDate(2026, 8, 1), ImportOrigin: "lea", StudentID: linkPtr(linkLea)},
		// 14 is imported, unlinked, a second copy of Ben while his
		// application contract 12 runs.
		{ContractID: 14, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Ben", LastName: "Muster",
			StartsOn: calendar.NewDate(2026, 9, 1), ImportOrigin: "ben"},
		// 15 is imported, unlinked, Ola's copy with another spelling.
		{ContractID: 15, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Ola", LastName: "Testfall",
			BirthDate: importDay(2017, 5, 6), StartsOn: calendar.NewDate(2026, 8, 1), ImportOrigin: "ola"},
	}
}

func linkStudentsFixture() map[int64]map[int64]carecontract.SchoolChild {
	return map[int64]map[int64]carecontract.SchoolChild{
		linkSchoolNorth: {
			linkMia: {StudentID: linkMia, FirstName: "mia ", LastName: "BEISPIEL", BirthDate: importDay(2018, 3, 4)},
			linkBen: {StudentID: linkBen, FirstName: "Ben", LastName: "Muster"},
			linkLea: {StudentID: linkLea, FirstName: "Lea", LastName: "Probe"},
			linkOla: {StudentID: linkOla, FirstName: "Ola", LastName: "Testfall", BirthDate: importDay(2017, 5, 7)},
		},
		linkSchoolSouth: {linkStrangerAtSouth: {StudentID: linkStrangerAtSouth, FirstName: "Mia", LastName: "Beispiel"}},
	}
}

func decideOne(t *testing.T, contracts []ports.ContractChild, pairs ...linkPair) []carecontract.ChildLinkRow {
	t.Helper()
	schools := []carecontract.School{{ID: linkSchoolNorth, Name: "OGS Nord"}, {ID: linkSchoolSouth, Name: "OGS Süd"}}
	rows, _ := decideChildLinks(pairs, schools, contracts, linkStudentsFixture(), linkToday)
	return rows
}

func linkProblem(field, code string) []carecontract.ChildLinkProblem {
	return []carecontract.ChildLinkProblem{{Field: field, Code: code}}
}

// Every status and every problem of a row, each by the first reason that
// applies (#7760, ADR 0232 addendum point 2).
func TestDecideChildLinksNamesEveryStatusAndProblem(t *testing.T) {
	t.Parallel()
	contracts := linkContractsFixture()
	missing := linkPair{line: 2, problems: linkProblem(carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemMissing)}
	notANumber := linkPair{line: 3, contractID: 11, problems: linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemInvalid)}
	cases := []struct {
		name     string
		pair     linkPair
		status   string
		problems []carecontract.ChildLinkProblem
	}{
		{"ready: same child, names folded", linkPair{line: 2, contractID: 11, studentID: linkMia}, carecontract.ChildLinkReady, []carecontract.ChildLinkProblem{}},
		{"linked to the named child already", linkPair{line: 2, contractID: 13, studentID: linkLea}, carecontract.ChildLinkLinked, []carecontract.ChildLinkProblem{}},
		{"missing identifier", missing, carecontract.ChildLinkInvalid, missing.problems},
		{"invalid identifier", notANumber, carecontract.ChildLinkInvalid, notANumber.problems},
		{"unknown contract, also one of another Träger", linkPair{line: 2, contractID: 99, studentID: linkMia}, carecontract.ChildLinkInvalid,
			linkProblem(carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemUnknown)},
		{"contract from an application", linkPair{line: 2, contractID: 12, studentID: linkBen}, carecontract.ChildLinkInvalid,
			linkProblem(carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemNotImported)},
		{"child of another school only", linkPair{line: 2, contractID: 11, studentID: linkStrangerAtSouth}, carecontract.ChildLinkInvalid,
			linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemUnknown)},
		{"contract linked to another child", linkPair{line: 2, contractID: 13, studentID: linkMia}, carecontract.ChildLinkConflict,
			linkProblem(carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemLinkedOther)},
		{"child has a running contract in the same time", linkPair{line: 2, contractID: 14, studentID: linkBen}, carecontract.ChildLinkConflict,
			linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemHasContract)},
		{"birth date differs", linkPair{line: 2, contractID: 15, studentID: linkOla}, carecontract.ChildLinkConflict,
			linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemDiffers)},
		{"name differs", linkPair{line: 2, contractID: 11, studentID: linkOla}, carecontract.ChildLinkConflict,
			[]carecontract.ChildLinkProblem{{Field: carecontract.ChildLinkFieldChild, Code: carecontract.ChildLinkProblemDiffers}}},
	}
	for _, tc := range cases {
		row := decideOne(t, contracts, tc.pair)[0]
		assert.Equal(t, tc.status, row.Status, tc.name)
		assert.Equal(t, tc.problems, row.Problems, tc.name)
	}
	other := decideOne(t, contracts, linkPair{line: 2, contractID: 14, studentID: linkBen})[0]
	assert.Equal(t, ident.ID(12), other.OtherContractID, "the conflict names the other contract")
}

// Rows that contradict each other link nothing, whatever their order: one
// contract with two child records, or one child record for two contracts of
// the same time. The same pair twice counts once.
func TestDecideChildLinksHoldsBackContradictingRows(t *testing.T) {
	t.Parallel()
	contracts := linkContractsFixture()
	rows := decideOne(t, contracts,
		linkPair{line: 2, contractID: 11, studentID: linkMia},
		linkPair{line: 3, contractID: 11, studentID: linkOla},
		linkPair{line: 4, contractID: 15, studentID: linkMia})
	for n, row := range rows {
		assert.Equal(t, carecontract.ChildLinkConflict, row.Status, "row %d", n)
	}
	assert.Equal(t, linkProblem(carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemRepeated), rows[0].Problems)
	assert.Equal(t, 3, rows[0].RepeatsLine, "the first row names the row that contradicts it")
	assert.Equal(t, 2, rows[1].RepeatsLine)
	assert.Equal(t, linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemRepeated), rows[2].Problems)
	assert.Equal(t, 2, rows[2].RepeatsLine)

	same := decideOne(t, contracts,
		linkPair{line: 2, contractID: 11, studentID: linkMia},
		linkPair{line: 3, contractID: 11, studentID: linkMia})
	assert.Equal(t, carecontract.ChildLinkReady, same[0].Status, "the same pair twice links once")
	assert.Equal(t, carecontract.ChildLinkConflict, same[1].Status)
	assert.Equal(t, 2, same[1].RepeatsLine)
}

// Two ended imported contracts of one time cannot both be the child's: the
// file holds both back, as it does for running ones.
func TestDecideChildLinksHoldsBackEndedContractsOfOneTime(t *testing.T) {
	t.Parallel()
	ended := calendar.NewDate(2026, 7, 31)
	contracts := []ports.ContractChild{
		{ContractID: 31, SchoolID: linkSchoolNorth, Status: carecontract.StatusEnded, FirstName: "Mia", LastName: "Beispiel",
			StartsOn: calendar.NewDate(2025, 8, 1), EndsOn: &ended, ImportOrigin: "mia-a"},
		{ContractID: 32, SchoolID: linkSchoolNorth, Status: carecontract.StatusEnded, FirstName: "Mia", LastName: "Beispiel",
			StartsOn: calendar.NewDate(2025, 9, 1), EndsOn: &ended, ImportOrigin: "mia-b"},
	}
	rows := decideOne(t, contracts, linkPair{line: 2, contractID: 31, studentID: linkMia}, linkPair{line: 3, contractID: 32, studentID: linkMia})
	assert.Equal(t, carecontract.ChildLinkConflict, rows[0].Status)
	assert.Equal(t, carecontract.ChildLinkConflict, rows[1].Status)
}

// The same holds across files: a contract that ended before today and is
// linked to the child still counts where its time meets the new one's.
func TestDecideChildLinksSeesAnEndedLinkedContractOfTheSameTime(t *testing.T) {
	t.Parallel()
	ended := calendar.NewDate(2026, 7, 31)
	contracts := []ports.ContractChild{
		{ContractID: 41, SchoolID: linkSchoolNorth, Status: carecontract.StatusEnded, FirstName: "Mia", LastName: "Beispiel",
			StartsOn: calendar.NewDate(2025, 8, 1), EndsOn: &ended, ImportOrigin: "mia-a", StudentID: linkPtr(linkMia)},
		{ContractID: 42, SchoolID: linkSchoolNorth, Status: carecontract.StatusEnded, FirstName: "Mia", LastName: "Beispiel",
			StartsOn: calendar.NewDate(2025, 9, 1), EndsOn: &ended, ImportOrigin: "mia-b"},
	}
	row := decideOne(t, contracts, linkPair{line: 2, contractID: 42, studentID: linkMia})[0]
	assert.Equal(t, carecontract.ChildLinkConflict, row.Status)
	assert.Equal(t, ident.ID(41), row.OtherContractID)
}

// Two imported contracts of one child that follow each other are both
// linked by one file: they share no day.
func TestDecideChildLinksLinksContractsThatFollowEachOther(t *testing.T) {
	t.Parallel()
	ended := calendar.NewDate(2026, 7, 31)
	contracts := []ports.ContractChild{
		{ContractID: 21, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Mia", LastName: "Beispiel",
			StartsOn: calendar.NewDate(2025, 8, 1), EndsOn: &ended, ImportOrigin: "mia-1"},
		{ContractID: 22, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Mia", LastName: "Beispiel",
			StartsOn: calendar.NewDate(2026, 8, 1), ImportOrigin: "mia-2"},
	}
	// The earlier contract still holds on the day of the run.
	rows, _ := decideChildLinks([]linkPair{{line: 2, contractID: 21, studentID: linkMia}, {line: 3, contractID: 22, studentID: linkMia}},
		[]carecontract.School{{ID: linkSchoolNorth, Name: "Nord"}}, contracts, linkStudentsFixture(), calendar.NewDate(2026, 7, 1))
	assert.Equal(t, carecontract.ChildLinkReady, rows[0].Status)
	assert.Equal(t, carecontract.ChildLinkReady, rows[1].Status)
}

// A running contract that is linked to no child record and names the child
// is the child's other contract: an application contract from before the
// school took the child over, the double contract the link must show.
func TestDecideChildLinksSeesAnUnlinkedContractOfTheChild(t *testing.T) {
	t.Parallel()
	contracts := append(linkContractsFixture(), ports.ContractChild{ContractID: 16, SchoolID: linkSchoolNorth,
		Status: carecontract.StatusActive, FirstName: "Mia", LastName: "Beispiel", StartsOn: calendar.NewDate(2026, 9, 1)})
	row := decideOne(t, contracts, linkPair{line: 2, contractID: 11, studentID: linkMia})[0]
	assert.Equal(t, carecontract.ChildLinkConflict, row.Status)
	assert.Equal(t, linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemHasContract), row.Problems)
	assert.Equal(t, ident.ID(16), row.OtherContractID)
}

// Namesakes whose child records carry no date of birth: the two imported
// contracts are born on different days, so neither is the other child's.
func TestDecideChildLinksTellsNamesakesApartByTheContracts(t *testing.T) {
	t.Parallel()
	contracts := []ports.ContractChild{
		{ContractID: 51, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Ben", LastName: "Muster",
			BirthDate: importDay(2018, 1, 2), StartsOn: calendar.NewDate(2026, 8, 1), ImportOrigin: "ben-a"},
		{ContractID: 52, SchoolID: linkSchoolNorth, Status: carecontract.StatusActive, FirstName: "Ben", LastName: "Muster",
			BirthDate: importDay(2019, 3, 4), StartsOn: calendar.NewDate(2026, 8, 1), ImportOrigin: "ben-b"},
	}
	row := decideOne(t, contracts, linkPair{line: 2, contractID: 51, studentID: linkBen})[0]
	assert.Equal(t, carecontract.ChildLinkReady, row.Status)
	// A child record with a date of birth is told apart by that date: the
	// other contract that names exactly this child stays a conflict.
	students := linkStudentsFixture()
	students[linkSchoolNorth][linkBen] = carecontract.SchoolChild{StudentID: linkBen, FirstName: "Ben", LastName: "Muster", BirthDate: importDay(2019, 3, 4)}
	rows, _ := decideChildLinks([]linkPair{{line: 2, contractID: 51, studentID: linkBen}},
		[]carecontract.School{{ID: linkSchoolNorth, Name: "OGS Nord"}}, contracts, students, linkToday)
	assert.Equal(t, ident.ID(52), rows[0].OtherContractID, "contract 52 names exactly this child")
}

// A row that links nothing contests no child record: the export of all
// contracts as a file also names contracts from applications and ended
// ones.
func TestDecideChildLinksIgnoresRowsThatLinkNothing(t *testing.T) {
	t.Parallel()
	contracts := linkContractsFixture()
	contracts[1].StudentID, contracts[1].Status = linkPtr(linkMia), carecontract.StatusWithdrawn
	rows := decideOne(t, contracts,
		linkPair{line: 2, contractID: 12, studentID: linkMia},
		linkPair{line: 3, contractID: 11, studentID: linkMia})
	assert.Equal(t, carecontract.ChildLinkInvalid, rows[0].Status, "a contract from an application")
	// Also with an empty child record, as the export of all contracts names
	// it: the row says that the contract needs no link, not that a number
	// is missing.
	missing := linkPair{line: 4, contractID: 12}
	missing.problems = linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemMissing)
	assert.Equal(t, linkProblem(carecontract.ChildLinkFieldContract, carecontract.ChildLinkProblemNotImported),
		decideOne(t, contracts, missing)[0].Problems)
	assert.Equal(t, carecontract.ChildLinkReady, rows[1].Status)
}

// Another running contract of the child is a conflict only where the two
// share a day: one that ends before this one starts is the previous phase.
func TestDecideChildLinksAllowsAContractOfAnEarlierPhase(t *testing.T) {
	t.Parallel()
	contracts := linkContractsFixture()
	ended := calendar.NewDate(2026, 12, 31)
	contracts[1].EndsOn = &ended // Ben's application contract ends on 31.12.
	contracts[3].StartsOn = calendar.NewDate(2027, 1, 1)
	row := decideOne(t, contracts, linkPair{line: 2, contractID: 14, studentID: linkBen})[0]
	assert.Equal(t, carecontract.ChildLinkReady, row.Status)
	contracts[3].StartsOn = calendar.NewDate(2026, 12, 31)
	row = decideOne(t, contracts, linkPair{line: 2, contractID: 14, studentID: linkBen})[0]
	assert.Equal(t, carecontract.ChildLinkConflict, row.Status, "one shared day is enough")
	contracts[1].Status = carecontract.StatusWithdrawn
	row = decideOne(t, contracts, linkPair{line: 2, contractID: 14, studentID: linkBen})[0]
	assert.Equal(t, carecontract.ChildLinkReady, row.Status, "a withdrawn contract holds nothing")
}

// A missing date of birth on either side says nothing, and names compare
// without case and repeated blanks.
func TestDecideChildLinksComparesLikeTheImport(t *testing.T) {
	t.Parallel()
	contracts := linkContractsFixture()
	contracts[4].BirthDate = nil
	contracts[4].FirstName, contracts[4].LastName = "  OLA ", "testfall"
	row := decideOne(t, contracts, linkPair{line: 2, contractID: 15, studentID: linkOla})[0]
	assert.Equal(t, carecontract.ChildLinkReady, row.Status)
	assert.Equal(t, "OGS Nord", row.SchoolName)
	assert.Equal(t, "Ola", row.StudentFirstName, "the row shows the child record beside the contract's copy")
	contracts[4].FirstName = "Ole"
	row = decideOne(t, contracts, linkPair{line: 2, contractID: 15, studentID: linkOla})[0]
	assert.Equal(t, linkProblem(carecontract.ChildLinkFieldChild, carecontract.ChildLinkProblemDiffers), row.Problems, "the name alone differs")
}

// The confirmation of a difference lifts only a row that the difference
// alone holds back.
func TestAcceptChildLinkDifferenceLiftsOnlyALoneDifference(t *testing.T) {
	t.Parallel()
	differs := carecontract.ChildLinkProblem{Field: carecontract.ChildLinkFieldChild, Code: carecontract.ChildLinkProblemDiffers}
	other := carecontract.ChildLinkProblem{Field: carecontract.ChildLinkFieldChild, Code: carecontract.ChildLinkProblemHasContract}
	rows := []carecontract.ChildLinkRow{
		{Status: carecontract.ChildLinkConflict, Problems: []carecontract.ChildLinkProblem{differs}},
		{Status: carecontract.ChildLinkConflict, Problems: []carecontract.ChildLinkProblem{other}},
		{Status: carecontract.ChildLinkConflict, Problems: []carecontract.ChildLinkProblem{differs, other}},
		{Status: carecontract.ChildLinkInvalid, Problems: []carecontract.ChildLinkProblem{differs}},
	}
	acceptChildLinkDifference(rows)
	assert.Equal(t, []string{carecontract.ChildLinkReady, carecontract.ChildLinkConflict, carecontract.ChildLinkConflict, carecontract.ChildLinkInvalid},
		[]string{rows[0].Status, rows[1].Status, rows[2].Status, rows[3].Status})
}

// coveredByImport closes the gap of ADR 0232 point 6: a running imported
// contract of the school covers the application child it belongs to, so the
// child gets no second contract. Before #7760 no imported contract covered
// any application child: the keys were those of application contracts only.
func TestCoveredByImportCoversTheChildOfARunningImportedContract(t *testing.T) {
	t.Parallel()
	full := 15000
	start := calendar.NewDate(2026, 8, 1)
	yearEnd := calendar.NewDate(2027, 7, 31)
	read := func(applications ...carecontract.Application) []schoolRead {
		return []schoolRead{{school: carecontract.School{ID: linkSchoolNorth}, applications: applications,
			offerings: map[int64]carecontract.Offering{
				1: {ID: 1, Name: "Ganztag", PriceCents: &full, EndTimes: map[string]string{"mon": "16:00"}},
				// 2 is a module of the school year 2026/27.
				2: {ID: 2, Name: "Ganztag 2026/27", PriceCents: &full, EndTimes: map[string]string{"mon": "16:00"}, ServiceEnd: &yearEnd},
			}}}
	}
	application := func(requestChildID int64, studentID *int64, first string, birth *calendar.Date, from calendar.Date) carecontract.Application {
		return carecontract.Application{RequestChildID: requestChildID, StudentID: studentID, ChildFirstName: first, ChildLastName: "Beispiel",
			ChildBirthDate: birth, Bookings: []carecontract.Booking{{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: &from}}}
	}
	imported := func(studentID *int64, first string, birth *calendar.Date, endsOn *calendar.Date, status string) ports.ContractChild {
		return ports.ContractChild{ContractID: 70, SchoolID: linkSchoolNorth, Status: status, FirstName: first, LastName: "Beispiel",
			BirthDate: birth, StartsOn: start, EndsOn: endsOn, ImportOrigin: "x", StudentID: studentID}
	}
	// The first booking ends with January 2027; the same module is approved
	// again from February, as a change to come.
	withLaterBooking := func(a carecontract.Application) carecontract.Application {
		january, february := calendar.NewDate(2027, 2, 1), calendar.NewDate(2027, 2, 1)
		a.Bookings[0].ValidUntil = &january
		a.Bookings = append(a.Bookings, carecontract.Booking{CareOfferingID: 1, Days: []string{"mon"}, ValidFrom: &february})
		return a
	}
	ofModule := func(a carecontract.Application, offering int64) carecontract.Application {
		a.Bookings[0].CareOfferingID = offering
		return a
	}
	importedFrom := func(c ports.ContractChild, from calendar.Date) ports.ContractChild {
		c.StartsOn = from
		return c
	}
	key := ContractKey{SchoolID: linkSchoolNorth, RequestChildID: 81}
	booked := calendar.NewDate(2026, 12, 1)
	cases := []struct {
		name        string
		application carecontract.Application
		contract    ports.ContractChild
		covered     bool
	}{
		{"linked to the child record of the application", application(81, linkPtr(linkMia), "Anders", nil, booked),
			imported(linkPtr(linkMia), "Mia", importDay(2018, 3, 4), nil, carecontract.StatusActive), true},
		{"linked to another child record", application(81, linkPtr(linkBen), "Mia", nil, booked),
			imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusActive), false},
		{"linked, the application names no child record: the names decide", application(81, nil, "Mia", nil, booked),
			imported(linkPtr(linkMia), "Mia", importDay(2018, 3, 4), nil, carecontract.StatusActive), true},
		{"linked, the application names no child record and another child", application(81, nil, "Ben", nil, booked),
			imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusActive), false},
		{"unlinked, same name, one birth date missing", application(81, nil, "mia", importDay(2018, 3, 4), booked),
			imported(nil, "Mia", nil, nil, carecontract.StatusActive), true},
		{"unlinked, different birth dates", application(81, nil, "Mia", importDay(2018, 3, 4), booked),
			imported(nil, "Mia", importDay(2018, 3, 5), nil, carecontract.StatusActive), false},
		{"ends before the booked care starts (renewal)", application(81, linkPtr(linkMia), "Mia", nil, calendar.NewDate(2027, 8, 1)),
			imported(linkPtr(linkMia), "Mia", nil, importDay(2027, 7, 31), carecontract.StatusActive), false},
		{"ended before today, but the booked care began before its end", application(81, linkPtr(linkMia), "Mia", nil, calendar.NewDate(2026, 9, 1)),
			imported(linkPtr(linkMia), "Mia", nil, importDay(2026, 10, 31), carecontract.StatusEnded), true},
		{"an approved booking to come reaches the import's start", withLaterBooking(application(81, linkPtr(linkMia), "Mia", nil, calendar.NewDate(2026, 6, 1))),
			importedFrom(imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusActive), calendar.NewDate(2027, 2, 1)), true},
		{"a booking without a stored end stops with the school year of its module", ofModule(application(81, linkPtr(linkMia), "Mia", nil, calendar.NewDate(2026, 8, 3)), 2),
			importedFrom(imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusActive), calendar.NewDate(2027, 8, 1)), false},
		{"withdrawn", application(81, linkPtr(linkMia), "Mia", nil, booked),
			imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusWithdrawn), false},
		{"ended", application(81, linkPtr(linkMia), "Mia", nil, booked),
			imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusEnded), false},
	}
	for _, tc := range cases {
		covered := coveredByImport(read(tc.application), []ports.ContractChild{tc.contract}, linkToday)
		assert.Equal(t, tc.covered, covered[key], tc.name)
	}
	// Only names: the candidate stays, held back, and names the contract.
	coverage := importCoverage(read(application(81, linkPtr(linkMia), "Mia", nil, booked)),
		[]ports.ContractChild{imported(nil, "Mia", nil, nil, carecontract.StatusActive)}, linkToday)
	assert.Equal(t, int64(70), coverage[key])
	candidates := []carecontract.Candidate{{CandidateKey: carecontract.CandidateKey{SchoolID: linkSchoolNorth, RequestChildID: 81}}}
	markNamedByImport(candidates, map[ContractKey]int64{key: 70})
	assert.Equal(t, carecontract.SkipImportedContract, candidates[0].TemplateIssue)
	assert.Equal(t, ident.ID(70), candidates[0].ImportedContractID)
	fromApplication := imported(linkPtr(linkMia), "Mia", nil, nil, carecontract.StatusActive)
	fromApplication.ImportOrigin = ""
	covered := coveredByImport(read(application(81, linkPtr(linkMia), "Mia", nil, booked)), []ports.ContractChild{fromApplication}, linkToday)
	assert.Empty(t, covered, "a contract from an application covers by its own key, not here")
}
