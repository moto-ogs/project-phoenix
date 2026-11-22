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
