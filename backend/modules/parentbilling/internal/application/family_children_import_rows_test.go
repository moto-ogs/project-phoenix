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
	headers := []string{"Vorname", "Nachname", "Kinderzahl", "Gültig ab"}
	schools := []parentbilling.CareSchool{{ID: ident.ID(school), Name: "Grundschule Nord"}}
	mapping := suggestFamilyImportMapping(headers)
	assert.Equal(t, "Gültig ab", mapping.Columns.ValidFrom, "moto maps the column by itself")
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
	assert.Nil(t, candidates[0].row.LaterValidFrom, "one family, one day")
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
}

// A child whose contracts belong to two families gives its number to both.
// One family's confirmation ran out on 31.10.: its number is renewed from
// 01.11., the other family's counts from the row's 15.10. The preview names
// both days the import stores (#7765).
func TestFamilyImportRowShowsBothDaysOfTwoFamilies(t *testing.T) {
	t.Parallel()
	const fresh, renewed = "neu@example.org", "abgelaufen@example.org"
	rowDay, ended := calendar.NewDate(2026, 10, 15), calendar.NewDate(2026, 10, 31)
	candidates := []familyImportCandidate{{
		row:       parentbilling.FamilyChildrenImportRow{Line: 2, Children: ptr(2)},
		targets:   []familyImportTarget{{family: fresh, contractID: 1}, {family: renewed, contractID: 2}},
		validFrom: rowDay,
	}}
	numbers := map[string]*familyNumbers{renewed: {brought: []*parentbilling.FamilyChildCount{{
		FamilyEmail: renewed, ConfirmedChildren: ptr(3), ValidFrom: ptr(calendar.NewDate(2026, 8, 1)), ValidUntil: &ended}}}}
	decideFamilyImport(candidates, numbers, calendar.NewDate(2026, 11, 22))

	row := candidates[0].row
	require.Equal(t, parentbilling.FamilyImportReady, row.Status)
	require.NotNil(t, row.ValidFrom)
	assert.Equal(t, rowDay, *row.ValidFrom, "the earliest day the number counts from")
	require.NotNil(t, row.LaterValidFrom, "the preview hides no day the import stores")
	assert.Equal(t, ended.AddDays(1), *row.LaterValidFrom)
	stored := map[string]calendar.Date{}
	for _, number := range newImportedChildren(candidates[0].decided) {
		stored[number.FamilyEmail] = number.ValidFrom
	}
	assert.Equal(t, map[string]calendar.Date{fresh: rowDay, renewed: ended.AddDays(1)}, stored, "the days the row shows are the days stored")
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
