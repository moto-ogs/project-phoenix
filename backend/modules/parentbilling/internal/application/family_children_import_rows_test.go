package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The day a number of a file counts from (#7765): the row's own column,
// else the day of the file, never the first day of the contract.
func TestFamilyImportRowsCountFromTheDayTheOfficeNames(t *testing.T) {
	t.Parallel()
	const school = int64(schoolIspringen)
	fileDay, contractStart := calendar.NewDate(2026, 11, 1), calendar.NewDate(2025, 8, 1)
	// A plain „Gültig ab“ can be the contract's first day: moto maps no day
	// column by itself there, the office chooses it.
	assert.Equal(t, "Kinderzahl gilt ab",
		suggestFamilyImportMapping([]string{"Vorname", "Nachname", "Kinderzahl", "Gültig ab", "Kinderzahl gilt ab"}).Columns.ValidFrom,
		"the column that names the number goes before a plain „Gültig ab“")
	assert.Empty(t, suggestFamilyImportMapping([]string{"Vorname", "Nachname", "Kinderzahl", "Gültig ab", "Stichtag"}).Columns.ValidFrom,
		"a plain „Gültig ab“ or „Stichtag“ is not mapped by itself")
	headers := []string{"Vorname", "Nachname", "Kinderzahl", "Kinderzahl gilt ab"}
	schools := []parentbilling.CareSchool{{ID: ident.ID(school), Name: "Grundschule Nord"}}
	mapping := suggestFamilyImportMapping(headers)
	assert.Equal(t, "Kinderzahl gilt ab", mapping.Columns.ValidFrom, "moto maps the column by itself")
	mapping.SchoolID, mapping.ValidFrom = ident.ID(school), &fileDay
	index, err := resolveFamilyImportMapping(headers, mapping, schools)
	require.NoError(t, err)

	contract := func(id int64, first string) parentbilling.CareContractVersion {
		return parentbilling.CareContractVersion{ContractID: id, SchoolID: school, ChildFirstName: first, ChildLastName: "Beispiel", From: contractStart}
	}
	check := familyImportCheck{index: index, schools: schools, recipients: map[int64]parentbilling.CareRecipient{},
		contracts: familyImportContracts([]parentbilling.CareContractVersion{contract(1, "Mia"), contract(2, "Noah"), contract(3, "Lia")})}
	candidates := []familyImportCandidate{
		check.candidate([]string{"Mia", "Beispiel", "2", "15.10.2026"}, 2),
		check.candidate([]string{"Noah", "Beispiel", "2", ""}, 3),
		check.candidate([]string{"Lia", "Beispiel", "2", "bald"}, 4),
	}
	decideFamilyImport(candidates, map[string]*familyNumbers{}, calendar.NewDate(2026, 11, 22))

	require.Equal(t, parentbilling.FamilyImportReady, candidates[0].row.Status)
	assert.Equal(t, calendar.NewDate(2026, 10, 15), *candidates[0].row.ValidFrom, "the row's own day goes before the day of the file")
	assert.Empty(t, candidates[0].row.LaterValidFrom, "one family, one day")
	require.Equal(t, parentbilling.FamilyImportReady, candidates[1].row.Status)
	assert.Equal(t, fileDay, *candidates[1].row.ValidFrom, "a row without a day takes the day of the file, not the contract's first day")
	assert.Equal(t, parentbilling.FamilyImportInvalid, candidates[2].row.Status, "a cell that is no day holds the row back")
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldValidFrom, Code: parentbilling.FamilyImportProblemInvalid}},
		candidates[2].row.Problems)
	assert.Nil(t, candidates[2].row.ValidFrom)

	var stored []calendar.Date
	for _, candidate := range candidates {
		for _, number := range newImportedChildren(candidate.decided) {
			stored = append(stored, number.ValidFrom)
		}
	}
	assert.Equal(t, []calendar.Date{calendar.NewDate(2026, 10, 15), fileDay}, stored, "the stored numbers count from the named days")
	// Siblings of one family that name different days share the earliest:
	// the preview shows the day the family's number is stored from.
	const family = "geschwister@example.org"
	check = familyImportCheck{index: index, schools: schools,
		recipients: map[int64]parentbilling.CareRecipient{1: {Email: family}, 2: {Email: family}},
		contracts:  familyImportContracts([]parentbilling.CareContractVersion{contract(1, "Mia"), contract(2, "Noah")})}
	siblings := []familyImportCandidate{
		check.candidate([]string{"Mia", "Beispiel", "2", "15.10.2026"}, 2),
		check.candidate([]string{"Noah", "Beispiel", "2", ""}, 3),
	}
	decideFamilyImport(siblings, map[string]*familyNumbers{}, calendar.NewDate(2026, 11, 22))
	var kept []importedChildren
	for _, sibling := range siblings {
		require.Equal(t, parentbilling.FamilyImportReady, sibling.row.Status)
		assert.Equal(t, calendar.NewDate(2026, 10, 15), *sibling.row.ValidFrom, "line %d shows the family's day", sibling.row.Line)
		kept = append(kept, sibling.decided...)
	}
	numbers := newImportedChildren(kept)
	require.Len(t, numbers, 1, "the family is stored once")
	assert.Equal(t, calendar.NewDate(2026, 10, 15), numbers[0].ValidFrom)
	// The number is stored on the contract of the row that names the
	// earliest day, also when that row comes second in the file.
	check = familyImportCheck{index: index, schools: schools,
		recipients: map[int64]parentbilling.CareRecipient{1: {Email: family}, 2: {Email: family}},
		contracts:  familyImportContracts([]parentbilling.CareContractVersion{contract(1, "Mia"), contract(2, "Noah")})}
	reversed := []familyImportCandidate{
		check.candidate([]string{"Noah", "Beispiel", "2", ""}, 2),
		check.candidate([]string{"Mia", "Beispiel", "2", "15.10.2026"}, 3),
	}
	decideFamilyImport(reversed, map[string]*familyNumbers{}, calendar.NewDate(2026, 11, 22))
	kept = nil
	for _, sibling := range reversed {
		assert.Equal(t, calendar.NewDate(2026, 10, 15), *sibling.row.ValidFrom, "line %d shows the family's day", sibling.row.Line)
		kept = append(kept, sibling.decided...)
	}
	numbers = newImportedChildren(kept)
	require.Len(t, numbers, 1)
	assert.Equal(t, calendar.NewDate(2026, 10, 15), numbers[0].ValidFrom)
	assert.Equal(t, int64(1), numbers[0].ContractID, "Mia's row names the day, her contract carries the number")
	// A row held back only by its day still speaks: Noah's row names three
	// with a cell that is no day, Mia's names two. The numbers of the family
	// disagree, so neither is taken over.
	check = familyImportCheck{index: index, schools: schools,
		recipients: map[int64]parentbilling.CareRecipient{1: {Email: family}, 2: {Email: family}},
		contracts:  familyImportContracts([]parentbilling.CareContractVersion{contract(1, "Mia"), contract(2, "Noah")})}
	disagreeing := []familyImportCandidate{
		check.candidate([]string{"Mia", "Beispiel", "2", ""}, 2),
		check.candidate([]string{"Noah", "Beispiel", "3", "bald"}, 3),
	}
	decideFamilyImport(disagreeing, map[string]*familyNumbers{}, calendar.NewDate(2026, 11, 22))
	assert.Equal(t, parentbilling.FamilyImportConflict, disagreeing[0].row.Status, "a sibling's row with a bad day names another number")
	assert.Equal(t, parentbilling.FamilyImportInvalid, disagreeing[1].row.Status)
	assert.Empty(t, newImportedChildren(disagreeing[0].decided), "nothing is stored for the family")
	// The same child twice, first with a cell that is no day: the second
	// row with a sound day and the same number is taken over.
	check = familyImportCheck{index: index, schools: schools, recipients: map[int64]parentbilling.CareRecipient{},
		contracts: familyImportContracts([]parentbilling.CareContractVersion{contract(1, "Mia")})}
	twice := []familyImportCandidate{
		check.candidate([]string{"Mia", "Beispiel", "2", "bald"}, 2),
		check.candidate([]string{"Mia", "Beispiel", "2", "01.12.2026"}, 3),
	}
	decideFamilyImport(twice, map[string]*familyNumbers{}, calendar.NewDate(2026, 11, 22))
	assert.Equal(t, parentbilling.FamilyImportInvalid, twice[0].row.Status)
	require.Equal(t, parentbilling.FamilyImportReady, twice[1].row.Status, "the sound row of the child counts")
	assert.Equal(t, calendar.NewDate(2026, 12, 1), *twice[1].row.ValidFrom)
}

// A file for the time after a confirmation that still holds today (#7765):
// the confirmation ends on 31.07.2027, the file counts from 01.08.2027. The
// row is taken over as the successor from its own day, whether it names the
// same number or another; the months before keep the confirmation. A file
// day inside the confirmation's time changes nothing.
func TestFamilyImportRenewsAConfirmationThatEndsBeforeTheFileDay(t *testing.T) {
	t.Parallel()
	const family = "familie@example.org"
	today, ends := calendar.NewDate(2026, 11, 22), calendar.NewDate(2027, 7, 31)
	began, runs := calendar.NewDate(2026, 8, 22), calendar.NewDate(2027, 8, 22)
	decideWith := func(children int, from calendar.Date, inForce ...familyImportSpan) parentbilling.FamilyChildrenImportRow {
		candidates := []familyImportCandidate{{
			row:       parentbilling.FamilyChildrenImportRow{Line: 2, Children: ptr(children)},
			targets:   []familyImportTarget{{family: family, contractID: 1, inForce: inForce}},
			validFrom: from,
		}, {
			// A sibling's row of the same family whose contract runs on:
			// it lends the first row no contract.
			row:       parentbilling.FamilyChildrenImportRow{Line: 3, Children: ptr(children)},
			targets:   []familyImportTarget{{family: family, contractID: 2, inForce: []familyImportSpan{{began, runs}}}},
			validFrom: today,
		}}
		numbers := map[string]*familyNumbers{family: {brought: []*parentbilling.FamilyChildCount{{
			FamilyEmail: family, ConfirmedChildren: ptr(3), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: &ends}}}}
		decideFamilyImport(candidates, numbers, today)
		return candidates[0].row
	}
	decide := func(children int, from calendar.Date) parentbilling.FamilyChildrenImportRow {
		return decideWith(children, from, familyImportSpan{began, runs})
	}
	// The child left the family: its contract there ended in August 2026.
	// Today decides, the confirmation still holds and is not renewed, also
	// when a sibling's contract in the family runs on.
	left := familyImportSpan{began, calendar.NewDate(2026, 8, 25)}
	assert.Equal(t, parentbilling.FamilyImportDiffers, decideWith(4, ends.AddDays(1), left).Status,
		"a family the child has left is not renewed ahead")
	// The child comes back in September 2027: neither contract covers the
	// row's day in August, the gap is not bridged.
	back := familyImportSpan{calendar.NewDate(2027, 9, 1), calendar.NewDate(2027, 12, 31)}
	assert.Equal(t, parentbilling.FamilyImportDiffers, decideWith(4, ends.AddDays(1), left, back).Status,
		"a later contract does not bridge a time without one")
	for _, children := range []int{3, 4} {
		row := decide(children, ends.AddDays(1))
		require.Equal(t, parentbilling.FamilyImportReady, row.Status, "%d children after the end are a successor", children)
		assert.Equal(t, ends.AddDays(1), *row.ValidFrom)
	}
	assert.Equal(t, parentbilling.FamilyImportSame, decide(3, ends).Status, "the confirmation still holds on the file's day")
	assert.Equal(t, parentbilling.FamilyImportDiffers, decide(4, ends).Status, "a number that holds is never overwritten")
}

// A child whose contracts belong to three families gives its number to
// each. Two families' confirmations ran out, on 31.10. and on 15.11.: their
// numbers are renewed from the day after, the third family's counts from
// the row's 15.10. The preview names every day the import stores (#7765).
func TestFamilyImportRowShowsEveryDayOfItsFamilies(t *testing.T) {
	t.Parallel()
	const fresh, renewed, late = "neu@example.org", "abgelaufen@example.org", "spaeter@example.org"
	rowDay, ended, endedLate := calendar.NewDate(2026, 10, 15), calendar.NewDate(2026, 10, 31), calendar.NewDate(2026, 11, 15)
	candidates := []familyImportCandidate{{
		row:       parentbilling.FamilyChildrenImportRow{Line: 2, Children: ptr(2)},
		targets:   []familyImportTarget{{family: late, contractID: 3}, {family: fresh, contractID: 1}, {family: renewed, contractID: 2}},
		validFrom: rowDay,
	}}
	expired := func(family string, until calendar.Date) *familyNumbers {
		return &familyNumbers{brought: []*parentbilling.FamilyChildCount{{
			FamilyEmail: family, ConfirmedChildren: ptr(3), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: &until}}}
	}
	numbers := map[string]*familyNumbers{renewed: expired(renewed, ended), late: expired(late, endedLate)}
	decideFamilyImport(candidates, numbers, calendar.NewDate(2026, 11, 22))

	row := candidates[0].row
	require.Equal(t, parentbilling.FamilyImportReady, row.Status)
	require.NotNil(t, row.ValidFrom)
	assert.Equal(t, rowDay, *row.ValidFrom, "the earliest day the number counts from")
	assert.Equal(t, []calendar.Date{ended.AddDays(1), endedLate.AddDays(1)}, row.LaterValidFrom, "the preview hides no day the import stores")
	stored := map[string]calendar.Date{}
	for _, number := range newImportedChildren(candidates[0].decided) {
		stored[number.FamilyEmail] = number.ValidFrom
	}
	assert.Equal(t, map[string]calendar.Date{fresh: rowDay, renewed: ended.AddDays(1), late: endedLate.AddDays(1)}, stored,
		"the days the row shows are the days stored")
}

// The times a row's child is part of a family come from the versions of
// its contracts, one each: a time between two versions of one contract is
// covered by none (#7765).
func TestFamilyImportTargetCoversOnlyTheVersionsOfTheContract(t *testing.T) {
	t.Parallel()
	version := func(from, until calendar.Date) parentbilling.CareContractVersion {
		return parentbilling.CareContractVersion{ContractID: 1, SchoolID: schoolIspringen, ChildFirstName: "Mia", ChildLastName: "Beispiel", From: from, Until: until}
	}
	check := familyImportCheck{recipients: map[int64]parentbilling.CareRecipient{}, contracts: familyImportContracts([]parentbilling.CareContractVersion{
		version(calendar.NewDate(2026, 8, 22), calendar.NewDate(2026, 11, 30)),
		version(calendar.NewDate(2027, 1, 1), calendar.NewDate(2027, 8, 22)),
	})}
	row := parentbilling.FamilyChildrenImportRow{Line: 2, ChildFirstName: "Mia", ChildLastName: "Beispiel"}
	targets := check.match(&row, schoolIspringen)
	require.Len(t, targets, 1)
	assert.True(t, targets[0].covers(calendar.NewDate(2026, 11, 30)), "the last day of the first version")
	assert.False(t, targets[0].covers(calendar.NewDate(2026, 12, 1)), "the time between the versions")
	assert.True(t, targets[0].covers(calendar.NewDate(2027, 1, 1)), "the first day of the second version")
	assert.False(t, targets[0].covers(calendar.NewDate(2027, 8, 23)), "after the last version read")
}

// Without a day from the office the numbers count from the day of the
// import, the one day the import itself proves; a mistyped year is refused.
func TestFamilyImportMappingSettlesTheDay(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	settled := settleFamilyImportMapping(parentbilling.FamilyChildrenImportMapping{}, nil, today)
	require.NotNil(t, settled.ValidFrom)
	assert.Equal(t, today, *settled.ValidFrom)

	named := calendar.NewDate(2026, 9, 1)
	settled = settleFamilyImportMapping(parentbilling.FamilyChildrenImportMapping{ValidFrom: &named}, nil, today)
	assert.Equal(t, named, *settled.ValidFrom, "the day the office named stays")

	mistyped := calendar.NewDate(26, 12, 1)
	_, err := resolveFamilyImportMapping(nil, parentbilling.FamilyChildrenImportMapping{ValidFrom: &mistyped}, nil)
	assert.ErrorContains(t, err, parentbilling.FamilyImportFieldValidFrom)
}
