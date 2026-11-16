package traegerstaff

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlanningWeekTableMissingSchools(t *testing.T) {
	t.Parallel()
	for _, people := range [][]workforce.TraegerPlanningPerson{
		nil, {{FirstName: "Mira"}, {FirstName: "Ali"}},
	} {
		table := planningWeekTable(workforce.TraegerPlanningWeek{
			WeekStart: calendar.NewDate(2026, 11, 23), People: people,
			Unreached: []workforce.TraegerStaffSchool{{Name: "OGS Nord"}, {Name: "OGS Süd"}},
		})
		const note = "Ohne die Schichten von: OGS Nord, OGS Süd"
		assert.Contains(t, table.Filters, note, "PDF keeps the warning in its head")
		require.NotEmpty(t, table.Rows, "an empty plan still needs a CSV warning row")
		require.Equal(t, "completeness", table.Columns[len(table.Columns)-1].ID)
		assert.True(t, table.Columns[len(table.Columns)-1].SpreadsheetOnly)
		for _, row := range table.Rows {
			require.Len(t, row, len(table.Columns))
			assert.Equal(t, note, row[len(row)-1], "CSV keeps the warning in the data")
		}
	}
	table := planningWeekTable(workforce.TraegerPlanningWeek{WeekStart: calendar.NewDate(2026, 11, 23)})
	assert.Empty(t, table.Rows, "a complete empty plan has no synthetic data row")
	assert.Len(t, table.Columns, 14, "a complete plan needs no warning column")
}
