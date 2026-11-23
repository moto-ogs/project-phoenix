package application

import (
	"context"
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
	index, err := resolveFamilyImportMapping(headers, mapping, schools, calendar.NewDate(2026, 11, 22))
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
	targets := check.match(&row, schoolIspringen, calendar.NewDate(2026, 11, 22), false)
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
	_, err := resolveFamilyImportMapping(nil, parentbilling.FamilyChildrenImportMapping{ValidFrom: &mistyped}, nil, today)
	assert.ErrorContains(t, err, parentbilling.FamilyImportFieldValidFrom)
}

// moto reads contracts only up to nine months ahead (#7863 point 3). A day
// beyond that holds the row back, whether the row names it or the file:
// moto cannot tell whether the child is still part of the family then,
// and a confirmation that holds today must not read as „schon bestätigt“
// for a time it has ended by.
func TestFamilyImportHoldsBackADayBeyondTheContractsMotoReads(t *testing.T) {
	t.Parallel()
	const school = int64(schoolIspringen)
	today := calendar.NewDate(2026, 11, 22)
	lastDay := today.AddDays(evidenceLookAhead)
	headers := []string{"Vorname", "Nachname", "Kinderzahl", "Kinderzahl gilt ab"}
	schools := []parentbilling.CareSchool{{ID: ident.ID(school), Name: "Grundschule Nord"}}
	check := func(fileDay calendar.Date) familyImportCheck {
		mapping := suggestFamilyImportMapping(headers)
		mapping.SchoolID, mapping.ValidFrom = ident.ID(school), &fileDay
		index, err := resolveFamilyImportMapping(headers, mapping, schools, today)
		require.NoError(t, err)
		return familyImportCheck{index: index, schools: schools, recipients: map[int64]parentbilling.CareRecipient{},
			contracts: familyImportContracts([]parentbilling.CareContractVersion{{ContractID: 1, SchoolID: school,
				ChildFirstName: "Mia", ChildLastName: "Beispiel", From: calendar.NewDate(2025, 8, 1), Until: lastDay}})}
	}
	tooFar := []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldValidFrom,
		Code: parentbilling.FamilyImportProblemTooFarAhead}}

	byRow := check(today)
	row := byRow.candidate([]string{"Mia", "Beispiel", "2", lastDay.AddDays(1).Format("02.01.2006")}, 2)
	assert.Equal(t, parentbilling.FamilyImportInvalid, row.row.Status, "the row's own day lies beyond the contracts moto reads")
	assert.Equal(t, tooFar, row.row.Problems)

	byFile := check(lastDay.AddDays(1))
	row = byFile.candidate([]string{"Mia", "Beispiel", "2", ""}, 2)
	assert.Equal(t, parentbilling.FamilyImportInvalid, row.row.Status, "the day of the file lies beyond the contracts moto reads")
	assert.Equal(t, tooFar, row.row.Problems)

	atEnd := check(today)
	row = atEnd.candidate([]string{"Mia", "Beispiel", "2", lastDay.Format("02.01.2006")}, 2)
	assert.Empty(t, row.row.Problems, "the last day moto reads still counts")
	assert.Empty(t, row.row.Status)
}

// A confirmation planned for a later day does not decide a row before
// then (#7863 point 4): the row compares with the number that holds on its
// day. A planned confirmation is still never overwritten: without a number
// that holds on the row's day, the row compares with the planned one.
func TestFamilyImportComparesWithTheConfirmationInForceOnTheRowDay(t *testing.T) {
	t.Parallel()
	const family = "familie@example.org"
	today, planned := calendar.NewDate(2026, 11, 22), calendar.NewDate(2027, 1, 1)
	decide := func(children int, retained ...parentbilling.FamilyChildConfirmation) parentbilling.FamilyChildrenImportRow {
		candidates := []familyImportCandidate{{
			row:       parentbilling.FamilyChildrenImportRow{Line: 2, Children: ptr(children)},
			targets:   []familyImportTarget{{family: family, contractID: 1}},
			validFrom: today,
		}}
		numbers := map[string]*familyNumbers{family: {own: &parentbilling.FamilyChildCount{
			ID: 7, ContractID: 1, FamilyEmail: family, ConfirmedChildren: ptr(3), ValidFrom: &planned, Confirmations: retained}}}
		decideFamilyImport(candidates, numbers, today)
		return candidates[0].row
	}
	holds := parentbilling.FamilyChildConfirmation{Children: ptr(2), ValidFrom: ptr(calendar.NewDate(2026, 1, 1))}

	row := decide(2, holds)
	assert.Equal(t, parentbilling.FamilyImportSame, row.Status, "two children hold this month")
	assert.Equal(t, ptr(2), row.ConfirmedChildren)
	row = decide(3, holds)
	assert.Equal(t, parentbilling.FamilyImportDiffers, row.Status, "three children count only from January")
	assert.Equal(t, ptr(2), row.ConfirmedChildren, "the row names the number that holds now")

	expired := parentbilling.FamilyChildConfirmation{Children: ptr(2), ValidFrom: ptr(calendar.NewDate(2026, 1, 1)),
		ValidUntil: ptr(calendar.NewDate(2026, 10, 31))}
	for _, retained := range [][]parentbilling.FamilyChildConfirmation{nil, {expired}} {
		row = decide(4, retained...)
		assert.Equal(t, parentbilling.FamilyImportDiffers, row.Status, "the planned confirmation is never overwritten")
		assert.Equal(t, ptr(3), row.ConfirmedChildren)
	}
}

// A row names its child's former family too while that contract lies in
// the three months moto reads back (#7863 point 5). The child is no part of
// that family any more: its expired confirmation is not renewed, only the
// family the child belongs to now gets the number. A child without a
// running contract holds its row back.
func TestFamilyImportLeavesOutAFamilyTheChildHasLeft(t *testing.T) {
	t.Parallel()
	const school = int64(schoolIspringen)
	const former, current = "frueher@example.org", "jetzt@example.org"
	today := calendar.NewDate(2026, 11, 22)
	headers := []string{"Vorname", "Nachname", "Kinderzahl"}
	schools := []parentbilling.CareSchool{{ID: ident.ID(school), Name: "Grundschule Nord"}}
	mapping := suggestFamilyImportMapping(headers)
	mapping.SchoolID, mapping.ValidFrom = ident.ID(school), &today
	index, err := resolveFamilyImportMapping(headers, mapping, schools, today)
	require.NoError(t, err)
	version := func(id int64, from, until calendar.Date) parentbilling.CareContractVersion {
		return parentbilling.CareContractVersion{ContractID: id, SchoolID: school, ChildFirstName: "Mia", ChildLastName: "Beispiel", From: from, Until: until}
	}
	const leftID, runsID int64 = 1, 2
	left := version(leftID, calendar.NewDate(2025, 8, 1), calendar.NewDate(2026, 10, 31))
	runs := version(runsID, calendar.NewDate(2026, 11, 1), today.AddDays(evidenceLookAhead))
	numbers := map[string]*familyNumbers{former: {own: &parentbilling.FamilyChildCount{ID: 5, ContractID: 1, FamilyEmail: former,
		ConfirmedChildren: ptr(3), ValidFrom: ptr(calendar.NewDate(2025, 8, 1)), ValidUntil: ptr(calendar.NewDate(2026, 11, 15))}}}
	recipients := map[int64]parentbilling.CareRecipient{1: {Email: former}, 2: {Email: current}}

	check := familyImportCheck{index: index, schools: schools, recipients: recipients, numbers: numbers,
		contracts: familyImportContracts([]parentbilling.CareContractVersion{left, runs})}
	candidates := []familyImportCandidate{check.candidate([]string{"Mia", "Beispiel", "2"}, 2)}
	decideFamilyImport(candidates, numbers, today)
	require.Equal(t, parentbilling.FamilyImportReady, candidates[0].row.Status)
	assert.Equal(t, today, *candidates[0].row.ValidFrom)
	assert.Empty(t, candidates[0].row.LaterValidFrom, "no renewal day of the former family")
	stored := newImportedChildren(candidates[0].decided)
	require.Len(t, stored, 1, "only the family the child belongs to now")
	assert.Equal(t, current, stored[0].FamilyEmail)
	assert.Equal(t, runsID, stored[0].ContractID)

	// The old contract covers this row's day, but not the first day of a renewal.
	index.validFrom = calendar.NewDate(2026, 10, 1)
	check = familyImportCheck{index: index, schools: schools, recipients: recipients, numbers: numbers,
		contracts: familyImportContracts([]parentbilling.CareContractVersion{left})}
	candidates = []familyImportCandidate{check.candidate([]string{"Mia", "Beispiel", "2"}, 2)}
	decideFamilyImport(candidates, numbers, today)
	assert.Equal(t, parentbilling.FamilyImportInvalid, candidates[0].row.Status, "the child's only contract has ended")
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldChildLastName,
		Code: parentbilling.FamilyImportProblemContractEnded}}, candidates[0].row.Problems)
	assert.Empty(t, newImportedChildren(candidates[0].decided))
}

func TestFamilyImportComparesCarriedConfirmationsOnTheDecisionDay(t *testing.T) {
	t.Parallel()
	const family = "familie@example.org"
	today, planned := calendar.NewDate(2026, 11, 22), calendar.NewDate(2027, 1, 1)
	source := func(id ident.ID, past *int, future int) *parentbilling.FamilyChildCount {
		count := &parentbilling.FamilyChildCount{
			ID: id, ContractID: id, ConfirmedChildren: ptr(future), ValidFrom: &planned,
		}
		if past != nil {
			count.Confirmations = []parentbilling.FamilyChildConfirmation{{Children: past, ValidFrom: ptr(calendar.NewDate(2026, 9, 1))}}
		}
		return count
	}
	decide := func(from calendar.Date, a, b *parentbilling.FamilyChildCount) parentbilling.FamilyChildrenImportRow {
		candidates := []familyImportCandidate{{
			row: parentbilling.FamilyChildrenImportRow{Line: 2, Children: ptr(2)}, validFrom: from,
			targets: []familyImportTarget{{family: family, contractID: int64(a.ContractID),
				inForce: []familyImportSpan{{today, planned}}}},
		}}
		decideFamilyImport(candidates, map[string]*familyNumbers{family: {brought: []*parentbilling.FamilyChildCount{a, b}}}, today)
		return candidates[0].row
	}
	a, b := source(1, ptr(2), 3), source(2, ptr(2), 4)
	row := decide(today, a, b)
	assert.Equal(t, parentbilling.FamilyImportSame, row.Status, "different planned counts do not conflict today")
	assert.Equal(t, ptr(2), row.ConfirmedChildren)
	assert.Equal(t, parentbilling.FamilyImportConflict, decide(planned, a, b).Status, "the planned counts conflict once they start")
	assert.Equal(t, parentbilling.FamilyImportConflict, decide(today, a, source(2, ptr(4), 3)).Status,
		"equal planned counts do not hide a current conflict")
	assert.Equal(t, parentbilling.FamilyImportConflict, decide(today, source(1, nil, 3), source(2, nil, 4)).Status,
		"without a current count, the file must not overwrite conflicting plans")
}

func TestFamilyImportAcceptsAFirstConfirmationForAHistoricalContract(t *testing.T) {
	t.Parallel()
	today, from := calendar.NewDate(2026, 11, 22), calendar.NewDate(2026, 10, 1)
	headers := []string{"Vorname", "Nachname", "Kinderzahl"}
	schools := []parentbilling.CareSchool{{ID: ident.ID(schoolIspringen), Name: "Grundschule Nord"}}
	mapping := suggestFamilyImportMapping(headers)
	mapping.SchoolID, mapping.ValidFrom = schools[0].ID, &from
	index, err := resolveFamilyImportMapping(headers, mapping, schools, today)
	require.NoError(t, err)
	contract := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2026-10-31")
	check := familyImportCheck{index: index, schools: schools, contracts: familyImportContracts([]parentbilling.CareContractVersion{contract})}
	candidates := []familyImportCandidate{check.candidate([]string{"Mia", "Beispiel", "2"}, 2)}
	decideFamilyImport(candidates, nil, today)
	require.Equal(t, parentbilling.FamilyImportReady, candidates[0].row.Status)
	assert.Equal(t, &from, candidates[0].row.ValidFrom)
	stored := newImportedChildren(candidates[0].decided)
	require.Len(t, stored, 1)
	assert.Equal(t, contract.ContractID, stored[0].ContractID)
	assert.Equal(t, from, stored[0].ValidFrom)
}

func TestFamilyImportBadDateStillContradictsSiblingAfterContractEnds(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	left := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2026-10-31")
	stayed := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-09-01", "2027-06-30")
	stayed.ChildFirstName = "Noah"

	result := applySiblingFamilyImport(t, today, []parentbilling.CareContractVersion{left, stayed}, nil,
		"Mia;Beispiel;3;kein Datum\nNoah;Beispiel;2;01.10.2026\n")
	require.Len(t, result.Rows, 2)
	assert.Equal(t, parentbilling.FamilyImportInvalid, result.Rows[0].Status)
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldValidFrom,
		Code: parentbilling.FamilyImportProblemInvalid}}, result.Rows[0].Problems)
	assert.Equal(t, parentbilling.FamilyImportConflict, result.Rows[1].Status)
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldChildren,
		Code: parentbilling.FamilyImportProblemRowsDiffer}}, result.Rows[1].Problems)
}

func TestFamilyImportCarriedConflictStillContradictsSiblingAfterExpiry(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	plannedFrom, plannedUntil := calendar.NewDate(2027, 1, 1), calendar.NewDate(2027, 1, 31)
	mia := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2027-06-30")
	noah := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-09-01", "2027-06-30")
	noah.ChildFirstName = "Noah"
	carried := func(version parentbilling.CareContractVersion, before int) parentbilling.FamilyChildCount {
		id := ident.ID(version.ContractID)
		return parentbilling.FamilyChildCount{ID: id, ContractID: id, FamilyEmail: parentbilling.ContractFamilyKey("", version.ContractID),
			ConfirmedChildren: ptr(4), ValidFrom: &plannedFrom, ValidUntil: &plannedUntil,
			Confirmations: []parentbilling.FamilyChildConfirmation{{Children: ptr(before), ValidFrom: &version.From}}}
	}
	result := applySiblingFamilyImport(t, today, []parentbilling.CareContractVersion{mia, noah},
		[]parentbilling.FamilyChildCount{carried(mia, 2), carried(noah, 3)},
		"Mia;Beispiel;2;22.11.2026\nNoah;Beispiel;3;01.02.2027\n")
	require.Len(t, result.Rows, 2)
	assert.Equal(t, parentbilling.FamilyImportConflict, result.Rows[0].Status)
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldChildren,
		Code: parentbilling.FamilyImportProblemConfirmationsDiffer}}, result.Rows[0].Problems)
	assert.Equal(t, parentbilling.FamilyImportConflict, result.Rows[1].Status)
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldChildren,
		Code: parentbilling.FamilyImportProblemRowsDiffer}}, result.Rows[1].Problems)
}

func applySiblingFamilyImport(t *testing.T, today calendar.Date, versions []parentbilling.CareContractVersion,
	counts []parentbilling.FamilyChildCount, lines string,
) parentbilling.FamilyChildrenImport {
	t.Helper()
	const family = "family@example.org"
	contracts := familySourceContracts{versions: versions, recipients: map[int64]parentbilling.CareRecipient{
		contractMia: {Email: family}, contractNoah: {Email: family},
	}}
	store := &siblingFamilyImportStore{familySourceStore: familySourceStore{counts: counts}}
	clock := func() calendar.Date { return today }
	imports := CareReductions{FamilyNumbers: NewFamilyChildren(store, contracts, clock), contracts: contracts,
		schools: traegerSchools{{ID: ident.ID(schoolIspringen), Name: "Grundschule Nord"}}, today: clock}
	ctx := context.Background()
	reviewer := parentbilling.HolidayReviewer{OrganizationID: 9, AccountID: 8}
	request := parentbilling.FamilyChildrenImportRequest{Content: []byte("Vorname;Nachname;Kinderzahl;Kinderzahl gilt ab\n" + lines)}
	preview, err := imports.ImportFamilyChildren(ctx, reviewer, request)
	require.NoError(t, err)
	request.Apply, request.Fingerprint = true, preview.Fingerprint
	applied, err := imports.ImportFamilyChildren(ctx, reviewer, request)
	require.NoError(t, err)
	require.True(t, applied.Applied)
	assert.Empty(t, store.stored, "contradicting sibling rows must not save a family count")
	return applied
}

type siblingFamilyImportStore struct {
	familySourceStore
	stored []parentbilling.ImportedFamilyChildren
}

func (s *siblingFamilyImportStore) ConfirmImportedFamilyChildren(_ context.Context, _, _ int64, numbers []parentbilling.ImportedFamilyChildren) error {
	s.stored = append(s.stored, numbers...)
	return nil
}

// A row whose renewal would start only after the child left still speaks
// against its siblings' rows for the family it belonged to on its day
// (#7863): both children were in the family on 01.10., the confirmation ran
// until 15.11., Mia's contract ended on 31.10. Neither row stores a number.
func TestFamilyImportRejectedRenewalStillContradictsSibling(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	left := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2026-10-31")
	stayed := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-09-01", "2027-06-30")
	stayed.ChildFirstName = "Noah"
	counts := []parentbilling.FamilyChildCount{{ID: 5, ContractID: ident.ID(contractNoah), FamilyEmail: "family@example.org",
		ConfirmedChildren: ptr(4), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: ptr(calendar.NewDate(2026, 11, 15))}}

	result := applySiblingFamilyImport(t, today, []parentbilling.CareContractVersion{left, stayed}, counts,
		"Mia;Beispiel;3;01.10.2026\nNoah;Beispiel;2;01.10.2026\n")
	require.Len(t, result.Rows, 2)
	assert.Equal(t, parentbilling.FamilyImportInvalid, result.Rows[0].Status)
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldChildLastName,
		Code: parentbilling.FamilyImportProblemContractEnded}}, result.Rows[0].Problems)
	assert.Equal(t, parentbilling.FamilyImportConflict, result.Rows[1].Status)
	assert.Equal(t, []parentbilling.FamilyChildrenImportProblem{{Field: parentbilling.FamilyImportFieldChildren,
		Code: parentbilling.FamilyImportProblemRowsDiffer}}, result.Rows[1].Problems)
}

// importSiblingRows previews and applies the lines for one family and
// returns the numbers stored.
func importSiblingRows(t *testing.T, today calendar.Date, versions []parentbilling.CareContractVersion,
	counts []parentbilling.FamilyChildCount, lines string,
) []parentbilling.ImportedFamilyChildren {
	t.Helper()
	return importFamilyRows(t, today, versions, map[int64]parentbilling.CareRecipient{
		contractMia: {Email: "family@example.org"}, contractNoah: {Email: "family@example.org"}, contractLea: {Email: "family@example.org"},
	}, counts, lines)
}

// importFamilyRows previews and applies the lines with the recipients given
// and returns the numbers stored.
func importFamilyRows(t *testing.T, today calendar.Date, versions []parentbilling.CareContractVersion,
	recipients map[int64]parentbilling.CareRecipient, counts []parentbilling.FamilyChildCount, lines string,
) []parentbilling.ImportedFamilyChildren {
	t.Helper()
	contracts := familySourceContracts{versions: versions, recipients: recipients}
	store := &siblingFamilyImportStore{familySourceStore: familySourceStore{counts: counts}}
	clock := func() calendar.Date { return today }
	imports := CareReductions{FamilyNumbers: NewFamilyChildren(store, contracts, clock), contracts: contracts,
		schools: traegerSchools{{ID: ident.ID(schoolIspringen), Name: "Grundschule Nord"}}, today: clock}
	reviewer := parentbilling.HolidayReviewer{OrganizationID: 9, AccountID: 8}
	request := parentbilling.FamilyChildrenImportRequest{Content: []byte("Vorname;Nachname;Kinderzahl;Kinderzahl gilt ab\n" + lines)}
	preview, err := imports.ImportFamilyChildren(context.Background(), reviewer, request)
	require.NoError(t, err)
	request.Apply, request.Fingerprint = true, preview.Fingerprint
	_, err = imports.ImportFamilyChildren(context.Background(), reviewer, request)
	require.NoError(t, err)
	return store.stored
}

// A witness speaks for all the times its child was in the family (#7863):
// Mia had a contract in September and another in October, both ended. Her
// September row and Noah's October row name different numbers; neither is
// taken over.
func TestFamilyImportWitnessCoversEveryContractOfTheFamily(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	september := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2026-09-30")
	october := sjrVersion(t, contractLea, schoolIspringen, 3, "2026-10-01", "2026-10-31")
	noah := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-09-01", "2027-06-30")
	noah.ChildFirstName = "Noah"
	expired := []parentbilling.FamilyChildCount{{ID: 5, ContractID: ident.ID(contractNoah), FamilyEmail: "family@example.org",
		ConfirmedChildren: ptr(4), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: ptr(calendar.NewDate(2026, 11, 15))}}
	stored := importSiblingRows(t, today, []parentbilling.CareContractVersion{september, october, noah}, expired,
		"Mia;Beispiel;3;01.09.2026\nNoah;Beispiel;2;01.10.2026\n")
	assert.Empty(t, stored, "contradicting sibling rows must not save a family count")
}

// A row of a family the child left speaks against its siblings' rows for
// any day, also for a day before moto's look back (#7863): Mia's August row
// and Noah's October row name different numbers; neither is taken over.
func TestFamilyImportLeftFamilyWitnessSpeaksBeyondTheLookBack(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	// VersionsInForce reads from 92 days back: Mia's contract from 01.08.
	// arrives starting on 22.08.
	mia := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-08-22", "2026-10-31")
	noah := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-08-22", "2027-06-30")
	noah.ChildFirstName = "Noah"
	expired := []parentbilling.FamilyChildCount{{ID: 5, ContractID: ident.ID(contractNoah), FamilyEmail: "family@example.org",
		ConfirmedChildren: ptr(4), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: ptr(calendar.NewDate(2026, 11, 15))}}
	stored := importSiblingRows(t, today, []parentbilling.CareContractVersion{mia, noah}, expired,
		"Mia;Beispiel;3;10.08.2026\nNoah;Beispiel;2;01.10.2026\n")
	assert.Empty(t, stored, "contradicting sibling rows must not save a family count")
}

// A row that contradicts a sibling in a family the child left takes over
// nothing, also not for its new family (#7863), as before point 5: Mia left
// family A on 31.10. for family B; her row says 3, Noah's in A says 2.
func TestFamilyImportContradictedRowStoresForNoOtherFamily(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	left := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2026-10-31")
	joined := sjrVersion(t, contractLea, schoolIspringen, 3, "2026-11-01", "2027-06-30")
	noah := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-09-01", "2027-06-30")
	noah.ChildFirstName = "Noah"
	expired := []parentbilling.FamilyChildCount{{ID: 5, ContractID: ident.ID(contractNoah), FamilyEmail: "family@example.org",
		ConfirmedChildren: ptr(4), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: ptr(calendar.NewDate(2026, 11, 15))}}
	stored := importFamilyRows(t, today, []parentbilling.CareContractVersion{left, joined, noah}, map[int64]parentbilling.CareRecipient{
		contractMia: {Email: "family@example.org"}, contractNoah: {Email: "family@example.org"}, contractLea: {Email: "other@example.org"},
	}, expired, "Mia;Beispiel;3;01.11.2026\nNoah;Beispiel;2;01.11.2026\n")
	assert.Empty(t, stored, "contradicting sibling rows must not save a family count")
}

// An ended contract of the child in the same family as its running one is
// no witness (#7863): it would hide the running contract's day. The
// renewal from 01.01. after the confirmation ran out on 15.12. is taken.
func TestFamilyImportEndedContractOfTheSameFamilyKeepsTheRenewal(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	ended := sjrVersion(t, contractLea, schoolIspringen, 3, "2026-09-01", "2026-10-31")
	ended.ChildFirstName = "Noah"
	running := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-11-01", "2027-06-30")
	running.ChildFirstName = "Noah"
	confirmed := []parentbilling.FamilyChildCount{{ID: 5, ContractID: ident.ID(contractNoah), FamilyEmail: "family@example.org",
		ConfirmedChildren: ptr(2), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: ptr(calendar.NewDate(2026, 12, 15))}}
	stored := importSiblingRows(t, today, []parentbilling.CareContractVersion{ended, running}, confirmed,
		"Noah;Beispiel;3;01.01.2027\n")
	require.Len(t, stored, 1)
	assert.Equal(t, 3, stored[0].Children)
	assert.Equal(t, calendar.NewDate(2027, 1, 1), stored[0].ValidFrom)
}

// A witness checks its family's rows also when that family's stored
// numbers disagree (#7863): Mia left family A, whose carried counts say 4
// and 5; her row says 3, Noah's in A says 2. Neither row is taken over.
func TestFamilyImportWitnessOfAFamilyWithDifferingNumbersStillContradicts(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 22)
	left := sjrVersion(t, contractMia, schoolIspringen, 1, "2026-09-01", "2026-10-31")
	joined := sjrVersion(t, contractLea, schoolIspringen, 3, "2026-11-01", "2027-06-30")
	noah := sjrVersion(t, contractNoah, schoolIspringen, 2, "2026-09-01", "2027-06-30")
	noah.ChildFirstName = "Noah"
	from := ptr(calendar.NewDate(2026, 8, 1))
	carried := []parentbilling.FamilyChildCount{
		{ID: 5, ContractID: ident.ID(contractNoah), FamilyEmail: "contract:502", ConfirmedChildren: ptr(4), ValidFrom: from},
		{ID: 6, ContractID: ident.ID(contractMia), FamilyEmail: "contract:501", ConfirmedChildren: ptr(5), ValidFrom: from},
	}
	stored := importFamilyRows(t, today, []parentbilling.CareContractVersion{left, joined, noah}, map[int64]parentbilling.CareRecipient{
		contractMia: {Email: "family@example.org"}, contractNoah: {Email: "family@example.org"}, contractLea: {Email: "other@example.org"},
	}, carried, "Mia;Beispiel;3;01.11.2026\nNoah;Beispiel;2;01.11.2026\n")
	assert.Empty(t, stored, "contradicting sibling rows must not save a family count")
}
