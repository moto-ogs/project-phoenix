package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The day the corrections of these tests hold from; the contracts begin on
// 2027-08-01.
var correctionDay = calendar.NewDate(2027, 9, 1)

// correctionSchool offers the modules of the school year 2027/28 the rows
// of these tests name, and a few a booking cannot go to.
func correctionSchool() importSchool {
	price := 9500
	year := func(id int64, name, end string, days ...string) carecontract.Offering {
		ends := map[string]string{}
		for _, day := range days {
			ends[day] = end
		}
		return carecontract.Offering{ID: id, Name: name, PhaseName: "Schuljahr 2027/28", PriceCents: &price, Active: true,
			EndTimes: ends, AvailableDays: days, ServiceStart: importDay(2027, 8, 1), ServiceEnd: importDay(2028, 7, 31)}
	}
	week := []string{"mon", "tue", "wed", "thu", "fri"}
	off := year(14, "Alt", "16:00", week...)
	off.Active = false
	later := year(16, "Später", "16:00", week...)
	later.ServiceStart, later.ServiceEnd = importDay(2028, 8, 1), importDay(2029, 7, 31)
	return importSchool{school: carecontract.School{ID: 1, Name: "Grundschule Nord"}, offerings: []carecontract.Offering{
		year(10, "OGS Mo-Mi", "16:00", "mon", "tue", "wed"), year(11, "OGS Do-Fr", "16:00", "thu", "fri"),
		year(12, "OGS Kurz", "14:00", week...), year(13, "OGS Lang", "16:00", week...),
		off, year(15, "Nur Freitag", "16:00", "fri"), later,
	}}
}

func correctionService(day string, offering int64, module, end string) carecontract.Service {
	return carecontract.Service{Weekday: day, CareOfferingID: ident.ID(offering), ModuleName: module, EndsAt: end}
}

// correctionContract is an active imported contract of the school with one
// version from 2027-08-01 that books the services.
func correctionContract(id int64, services ...carecontract.Service) ports.CorrectableContract {
	return ports.CorrectableContract{ID: id, SchoolID: 1, Status: carecontract.StatusActive, NextNumber: 2,
		Versions: []carecontract.Version{{ID: ident.ID(id * 100), Number: 1, Status: carecontract.VersionEffective,
			EffectiveFrom: calendar.NewDate(2027, 8, 1), EndsOn: importDay(2028, 7, 31), ChildFirstName: "Lia", ChildLastName: "Beispiel",
			Source: carecontract.SourceImport, Services: services}}}
}

// earlyAndLate books Monday twice: the early module until 14:00 and the
// late one until 16:00.
func earlyAndLate(id int64) ports.CorrectableContract {
	return correctionContract(id, correctionService("mon", 10, "OGS Mo-Mi", "14:00"), correctionService("mon", 11, "OGS Do-Fr", "16:00"))
}

// correctionRows decides the rows of one contract: each row is a weekday,
// the current and the target module, the file's lines start at 2.
func correctionRows(t *testing.T, contract ports.CorrectableContract, rows ...[3]string) correctionCandidate {
	t.Helper()
	table := textnorm.CSVTable{Headers: []string{"Vertrag", "Wochentag", "Bisheriges Angebot", "Zielangebot"}}
	for n, row := range rows {
		table.Rows = append(table.Rows, []string{ident.ID(contract.ID).String(), row[0], row[1], row[2]})
		table.Lines = append(table.Lines, n+2)
	}
	index, missing := offeringCorrectionIndex(table.Headers)
	require.Empty(t, missing)
	groups := readCorrectionGroups(table, index)
	require.Len(t, groups, 1)
	check := newCorrectionCheck([]ports.CorrectableContract{contract}, []importSchool{correctionSchool()}, correctionDay)
	return check.candidate(groups[0])
}

func problemCodes(candidate correctionCandidate) []string {
	codes := []string{}
	for _, problem := range candidate.contract.Problems {
		codes = append(codes, problem.Code)
	}
	return codes
}

func TestOfferingCorrectionHeadersPickTheTargetOffering(t *testing.T) {
	t.Parallel()
	// The layout of a correction list: the module column names the area of
	// the target, the offering column the module itself.
	headers := []string{"Moto_Vertrag_ID", "OGS_Vertrag_ID", "Moto_Kind_ID", "OGS_Kind_ID", "Bisheriges_Moto_Angebot",
		"Zielbereich", "Zielmodul", "Zielangebot", "Wochentag", "Bemerkung"}
	index, missing := offeringCorrectionIndex(headers)
	assert.Empty(t, missing)
	assert.Equal(t, map[string]int{
		carecontract.OfferingCorrectionFieldContract: 0, carecontract.OfferingCorrectionFieldCurrent: 4,
		carecontract.OfferingCorrectionFieldTarget: 7, carecontract.OfferingCorrectionFieldWeekday: 8,
	}, index)

	_, missing = offeringCorrectionIndex([]string{"Vertrag", "Wochentag"})
	assert.Equal(t, []string{carecontract.OfferingCorrectionFieldCurrent, carecontract.OfferingCorrectionFieldTarget}, missing)
}

func TestOfferingCorrectionMovesOnlyTheModuleOfEachBooking(t *testing.T) {
	t.Parallel()
	contract := correctionContract(1,
		correctionService("mon", 10, "OGS Mo-Mi", "16:00"), correctionService("tue", 10, "OGS Mo-Mi", "16:00"),
		correctionService("wed", 10, "OGS Mo-Mi", "15:00"), correctionService("thu", 11, "OGS Do-Fr", "16:00"),
		correctionService("fri", 11, "OGS Do-Fr", "16:00"))
	last := calendar.NewDate(2028, 1, 31)
	contract.Versions[0].Services[4].LastDay = &last
	// One row names a range of weekdays, the other two days.
	candidate := correctionRows(t, contract, [3]string{"Mo-Mi", "OGS Mo-Mi", "OGS Lang"}, [3]string{"Do, Fr", "OGS Do-Fr", "OGS Lang"})

	require.NotNil(t, candidate.version, candidate.contract.Problems)
	assert.Equal(t, carecontract.OfferingCorrectionReady, candidate.contract.Status)
	assert.Equal(t, []int{2, 3}, candidate.lines)
	assert.Equal(t, []carecontract.OfferingCorrectionChange{
		{Weekdays: []string{"mon", "tue", "wed"}, From: "OGS Mo-Mi", To: "OGS Lang"},
		{Weekdays: []string{"thu", "fri"}, From: "OGS Do-Fr", To: "OGS Lang"},
	}, candidate.contract.Changes)
	assert.Equal(t, []string{carecontract.OfferingCorrectionHintEndTimeDiffers}, candidate.contract.Hints,
		"Wednesday ends at 15:00, the target at 16:00: the contract keeps its own")
	version := candidate.version.Version
	assert.Equal(t, ports.VersionStep{Supersede: 100, Status: carecontract.VersionEffective}, candidate.version.Step,
		"a later day follows the version in force")
	assert.Equal(t, 2, version.Number)
	assert.Equal(t, correctionDay, version.EffectiveFrom)
	assert.Equal(t, carecontract.SourceOfferingCorrection, version.Source)
	assert.Equal(t, carecontract.VersionEffective, version.Status)
	assert.Equal(t, "Lia", version.ChildFirstName)
	want := []carecontract.Service{
		correctionService("mon", 13, "OGS Lang", "16:00"), correctionService("tue", 13, "OGS Lang", "16:00"),
		correctionService("wed", 13, "OGS Lang", "15:00"), correctionService("thu", 13, "OGS Lang", "16:00"),
		correctionService("fri", 13, "OGS Lang", "16:00"),
	}
	want[4].LastDay = &last
	assert.Equal(t, want, version.Services, "weekday, end time and last day stay")
	require.NotNil(t, version.PriceCents)
	assert.Equal(t, int64(9500), *version.PriceCents, "one module keeps its price")
	assert.Equal(t, carecontract.VersionEffective, contract.Versions[0].Status, "the read version is not touched")
	assert.Equal(t, "OGS Mo-Mi", contract.Versions[0].Services[0].ModuleName)
}

func TestOfferingCorrectionMovesTwoBookingsOfOneWeekdayApart(t *testing.T) {
	t.Parallel()
	candidate := correctionRows(t, earlyAndLate(2), [3]string{"Montag", "OGS Mo-Mi", "OGS Kurz"}, [3]string{"Montag", "OGS Do-Fr", "OGS Lang"})
	require.NotNil(t, candidate.version, candidate.contract.Problems)
	assert.Equal(t, []carecontract.Service{correctionService("mon", 12, "OGS Kurz", "14:00"), correctionService("mon", 13, "OGS Lang", "16:00")},
		candidate.version.Version.Services)
	assert.Nil(t, candidate.version.Version.PriceCents, "two modules have no single price")
}

// Rows that hand a module on (A to B, B to C) or swap two bookings would
// change the contract again on every repeated run: the file is refused.
func TestOfferingCorrectionRefusesRowsThatOverlap(t *testing.T) {
	t.Parallel()
	both := func(id int64) ports.CorrectableContract {
		return correctionContract(id, correctionService("mon", 12, "OGS Kurz", "14:00"), correctionService("mon", 13, "OGS Lang", "16:00"))
	}
	chain := correctionRows(t, both(3), [3]string{"Mo", "OGS Kurz", "OGS Lang"}, [3]string{"Mo", "OGS Lang", "OGS Mo-Mi"})
	assert.Nil(t, chain.version)
	assert.Contains(t, problemCodes(chain), carecontract.OfferingCorrectionProblemOverlapping)
	swap := correctionRows(t, both(4), [3]string{"Mo", "OGS Kurz", "OGS Lang"}, [3]string{"Mo", "OGS Lang", "OGS Kurz"})
	assert.Nil(t, swap.version)
	assert.Contains(t, problemCodes(swap), carecontract.OfferingCorrectionProblemOverlapping)
	reversed := correctionRows(t, both(5), [3]string{"Mo", "OGS Lang", "OGS Mo-Mi"}, [3]string{"Mo", "OGS Kurz", "OGS Lang"})
	assert.Nil(t, reversed.version)
	assert.Contains(t, problemCodes(reversed), carecontract.OfferingCorrectionProblemOverlapping)

	// A booking a row has just moved does not stand in for a module the
	// contract never booked.
	one := correctionContract(6, correctionService("mon", 12, "OGS Kurz", "14:00"))
	unbooked := correctionRows(t, one, [3]string{"Mo", "OGS Kurz", "OGS Lang"}, [3]string{"Mo", "OGS Mo-Mi", "OGS Lang"})
	assert.Nil(t, unbooked.version)
	assert.Contains(t, problemCodes(unbooked), carecontract.OfferingCorrectionProblemNotBooked)
}

// A contract keeps the name its module had at the import. A row finds the
// booking under the name the module has today too, and rows that hand a
// module on are refused by the module, not by its name.
func TestOfferingCorrectionKnowsARenamedModule(t *testing.T) {
	t.Parallel()
	renamed := func(id int64) ports.CorrectableContract {
		return correctionContract(id, correctionService("mon", 12, "Kurz alt", "14:00"), correctionService("mon", 13, "Lang alt", "16:00"))
	}
	found := correctionRows(t, renamed(8), [3]string{"Mo", "OGS Kurz", "OGS Mo-Mi"})
	require.NotNil(t, found.version, found.contract.Problems)
	assert.Equal(t, int64(10), found.version.Version.Services[0].CareOfferingID.Int64())

	for name, rows := range map[string][][3]string{
		"a booking under its old name is no finished move": {{"Mo", "OGS Mo-Mi", "OGS Lang"}, {"Mo", "Lang alt", "OGS Do-Fr"}},
		"the same rows the other way round":                {{"Mo", "Lang alt", "OGS Do-Fr"}, {"Mo", "OGS Mo-Mi", "OGS Lang"}},
		"a swap under the old names":                       {{"Mo", "Kurz alt", "OGS Lang"}, {"Mo", "Lang alt", "OGS Kurz"}},
	} {
		candidate := correctionRows(t, renamed(9), rows...)
		assert.Nil(t, candidate.version, name)
		assert.Contains(t, problemCodes(candidate), carecontract.OfferingCorrectionProblemOverlapping, name)
	}
}

// What a row names must be one booking, whatever the order of the rows.
func TestOfferingCorrectionRefusesRowsItCannotTellApart(t *testing.T) {
	t.Parallel()
	// Monday books Kurz and Mo-Mi, not Lang: the rows still hand Lang on.
	gap := correctionContract(10, correctionService("mon", 12, "OGS Kurz", "14:00"), correctionService("mon", 10, "OGS Mo-Mi", "16:00"))
	chain := correctionRows(t, gap, [3]string{"Mo", "OGS Kurz", "OGS Lang"}, [3]string{"Mo", "OGS Lang", "OGS Mo-Mi"})
	assert.Nil(t, chain.version)
	assert.Equal(t, []string{carecontract.OfferingCorrectionProblemOverlapping, carecontract.OfferingCorrectionProblemOverlapping}, problemCodes(chain))

	// One booking keeps the name the other module has today.
	shadow := correctionContract(11, correctionService("mon", 12, "Kurz alt", "14:00"), correctionService("mon", 13, "OGS Kurz", "16:00"))
	twice := correctionRows(t, shadow, [3]string{"Mo", "OGS Kurz", "OGS Mo-Mi"})
	assert.Nil(t, twice.version)
	assert.Equal(t, []string{carecontract.OfferingCorrectionProblemAmbiguous}, problemCodes(twice))

	// Two rows name one booking, once by its old and once by its new name.
	alias := func(rows ...[3]string) correctionCandidate {
		contract := correctionContract(12, correctionService("mon", 12, "Kurz alt", "14:00"), correctionService("mon", 11, "OGS Do-Fr", "16:00"))
		return correctionRows(t, contract, rows...)
	}
	for _, candidate := range []correctionCandidate{
		alias([3]string{"Mo", "OGS Kurz", "OGS Lang"}, [3]string{"Mo", "Kurz alt", "OGS Do-Fr"}),
		alias([3]string{"Mo", "Kurz alt", "OGS Do-Fr"}, [3]string{"Mo", "OGS Kurz", "OGS Lang"}),
	} {
		assert.Nil(t, candidate.version)
		assert.Contains(t, problemCodes(candidate), carecontract.OfferingCorrectionProblemRepeated)
	}
}

// The booking keeps its last day, so a target whose phase ends earlier
// cannot take it.
func TestOfferingCorrectionRefusesATargetThatEndsBeforeTheBooking(t *testing.T) {
	t.Parallel()
	contract := correctionContract(7, correctionService("mon", 12, "OGS Kurz", "14:00"))
	contract.Versions[0].EndsOn = importDay(2028, 12, 31)
	candidate := correctionRows(t, contract, [3]string{"Mo", "OGS Kurz", "OGS Lang"})
	assert.Nil(t, candidate.version)
	assert.Equal(t, []string{carecontract.OfferingCorrectionProblemOutsidePhase}, problemCodes(candidate))
}

func TestOfferingCorrectionRefusesWhatItCannotDecide(t *testing.T) {
	t.Parallel()
	ended := correctionContract(4, correctionService("mon", 10, "OGS Mo-Mi", "16:00"))
	lastDay := calendar.NewDate(2027, 8, 31)
	ended.EndsOn = &lastDay
	later := correctionContract(5, correctionService("mon", 10, "OGS Mo-Mi", "16:00"))
	later.Versions = append(later.Versions, carecontract.Version{ID: 501, Number: 2, Status: carecontract.VersionEffective,
		EffectiveFrom: calendar.NewDate(2027, 10, 1), Services: later.Versions[0].Services})
	applied := correctionContract(6, correctionService("mon", 10, "OGS Mo-Mi", "16:00"))
	applied.FollowsBookings = true
	monday := correctionContract(7, correctionService("mon", 10, "OGS Mo-Mi", "16:00"))
	for name, test := range map[string]struct {
		contract ports.CorrectableContract
		rows     [][3]string
		problems []string
		line     int
	}{
		"two bookings of a weekday to one target": {earlyAndLate(8), [][3]string{{"Mo", "OGS Mo-Mi", "OGS Lang"}, {"Mo", "OGS Do-Fr", "OGS Lang"}},
			[]string{carecontract.OfferingCorrectionProblemDoubleBooked}, 3},
		"a booking named twice":      {monday, [][3]string{{"Mo", "OGS Mo-Mi", "OGS Lang"}, {"Montag", "ogs mo-mi", "OGS Kurz"}}, []string{carecontract.OfferingCorrectionProblemRepeated}, 3},
		"a version after the day":    {later, [][3]string{{"Mo", "OGS Mo-Mi", "OGS Lang"}}, []string{carecontract.OfferingCorrectionProblemLaterVersion}, 2},
		"a contract ended before it": {ended, [][3]string{{"Mo", "OGS Mo-Mi", "OGS Lang"}}, []string{carecontract.OfferingCorrectionProblemEnded}, 2},
		"a contract from an application": {applied, [][3]string{{"Mo", "OGS Mo-Mi", "OGS Lang"}},
			[]string{carecontract.OfferingCorrectionProblemFollowsBookings}, 2},
		"a module not booked that day": {monday, [][3]string{{"Di", "OGS Mo-Mi", "OGS Lang"}}, []string{carecontract.OfferingCorrectionProblemNotBooked}, 2},
		"a switched-off target":        {monday, [][3]string{{"Mo", "OGS Mo-Mi", "Alt"}}, []string{carecontract.OfferingCorrectionProblemInactive}, 2},
		"a target without the weekday": {monday, [][3]string{{"Mo", "OGS Mo-Mi", "Nur Freitag"}}, []string{carecontract.OfferingCorrectionProblemNotOffered}, 2},
		"a target of a later phase":    {monday, [][3]string{{"Mo", "OGS Mo-Mi", "Später"}}, []string{carecontract.OfferingCorrectionProblemOutsidePhase}, 2},
		"an unknown target":            {monday, [][3]string{{"Mo", "OGS Mo-Mi", "Gibt es nicht"}}, []string{carecontract.OfferingCorrectionProblemUnknown}, 2},
		"no weekday":                   {monday, [][3]string{{"Feiertag", "OGS Mo-Mi", "OGS Lang"}}, []string{carecontract.OfferingCorrectionProblemInvalid}, 2},
	} {
		candidate := correctionRows(t, test.contract, test.rows...)
		assert.Nil(t, candidate.version, name)
		assert.Equal(t, carecontract.OfferingCorrectionInvalid, candidate.contract.Status, name)
		assert.Equal(t, test.problems, problemCodes(candidate), name)
		if len(candidate.contract.Problems) > 0 {
			assert.Equal(t, test.line, candidate.contract.Problems[0].Line, name)
		}
	}

	check := newCorrectionCheck(nil, []importSchool{correctionSchool()}, correctionDay)
	unknown := check.candidate(correctionGroup{reference: "99", id: 99, rows: []correctionRow{{line: 2, days: []string{"mon"}, daysOK: true,
		current: "OGS Mo-Mi", target: "OGS Lang"}}})
	assert.Equal(t, []string{carecontract.OfferingCorrectionProblemUnknown}, problemCodes(unknown), "a contract the Träger does not have")
	assert.Zero(t, unknown.contract.ContractID)
}

func TestOfferingCorrectionHoldsAContractWithAnUndecidedRow(t *testing.T) {
	t.Parallel()
	candidate := correctionRows(t, earlyAndLate(9), [3]string{"Mo", "OGS Mo-Mi", "OGS Kurz"}, [3]string{"Mo", "OGS Do-Fr", ""})
	assert.Nil(t, candidate.version)
	assert.Equal(t, carecontract.OfferingCorrectionHeld, candidate.contract.Status)
	assert.Empty(t, candidate.contract.Problems)
	assert.Contains(t, candidate.contract.Changes, carecontract.OfferingCorrectionChange{Weekdays: []string{"mon"}, From: "OGS Do-Fr", To: ""})
}

func TestOfferingCorrectionOfACorrectedContractChangesNothing(t *testing.T) {
	t.Parallel()
	corrected := correctionContract(10, correctionService("mon", 13, "OGS Lang", "16:00"), correctionService("tue", 13, "OGS Lang", "16:00"))
	candidate := correctionRows(t, corrected, [3]string{"Mo-Di", "OGS Mo-Mi", "OGS Lang"})
	assert.Nil(t, candidate.version)
	assert.Equal(t, carecontract.OfferingCorrectionUnchanged, candidate.contract.Status)
	assert.Empty(t, candidate.contract.Problems)
}

func TestOfferingCorrectionOfALaterContractHoldsFromItsFirstDay(t *testing.T) {
	t.Parallel()
	contract := correctionContract(11, correctionService("mon", 10, "OGS Mo-Mi", "16:00"))
	first := calendar.NewDate(2027, 10, 1)
	contract.Versions[0].EffectiveFrom = first
	candidate := correctionRows(t, contract, [3]string{"Mo", "OGS Mo-Mi", "OGS Lang"})
	require.NotNil(t, candidate.version, candidate.contract.Problems)
	assert.Equal(t, []string{carecontract.OfferingCorrectionHintStartMoved}, candidate.contract.Hints)
	assert.Equal(t, first, candidate.version.Version.EffectiveFrom)
	require.NotNil(t, candidate.contract.EffectiveFrom)
	assert.Equal(t, first, *candidate.contract.EffectiveFrom)
	assert.Equal(t, ports.VersionStep{Replace: 1100, Status: carecontract.VersionEffective}, candidate.version.Step,
		"a version from the same day replaces the first one")
}
