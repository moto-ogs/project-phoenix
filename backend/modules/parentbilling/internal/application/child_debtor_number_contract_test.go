package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// What the office saves for a family goes with the contract it was saved
// through, so the list opens the family by the contract that runs longest
// (#7770), whatever the order of the contracts.
func TestFamilyIsOpenedByItsLongestRunningContract(t *testing.T) {
	t.Parallel()
	ended := contractChild{family: "family@example.org", contractID: 1, until: calendar.NewDate(2026, 7, 31),
		child: parentbilling.FamilyChild{FirstName: "Mia", LastName: "Beispiel"}}
	running := contractChild{family: "family@example.org", contractID: 2, until: calendar.NewDate(2028, 7, 31),
		child: parentbilling.FamilyChild{FirstName: "Noah", LastName: "Beispiel"}}
	for _, ordered := range [][]contractChild{{ended, running}, {running, ended}} {
		families, read := familyChildNumbers(ordered, nil)
		require.Len(t, families, 1)
		assert.EqualValues(t, 2, families[0].ContractID)
		assert.Len(t, families[0].Children, 2)
		assert.Empty(t, read)
	}
}
