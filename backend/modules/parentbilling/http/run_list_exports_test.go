package parentbillinghttp

import (
	"testing"

	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunListAmountsRemainNumericAndOptional(t *testing.T) {
	t.Parallel()
	zero, positive, negative := int64(0), int64(123450), int64(-123450)
	var holidayRuns []capability.BillingRun
	var monthlyRuns []capability.CareRun
	for _, total := range []*int64{nil, &zero, &positive, &negative} {
		holidayRuns = append(holidayRuns, capability.BillingRun{TotalCents: total})
		monthlyRuns = append(monthlyRuns, capability.CareRun{TotalCents: total})
	}
	holiday := billingRunTable(holidayRuns, 0)
	monthly := careRunTable(monthlyRuns, nil)
	require.Len(t, holiday.Rows, 4)
	require.Len(t, monthly.Rows, 4)
	assert.True(t, holiday.Columns[4].Numeric)
	assert.True(t, monthly.Columns[4].Numeric)
	assert.Equal(t, "Summe (Euro)", holiday.Columns[4].Label)
	assert.Equal(t, "Summe (Euro)", monthly.Columns[4].Label)
	for row, want := range []string{"", "0,00", "1234,50", "-1234,50"} {
		assert.Equal(t, want, holiday.Rows[row][4], holiday.Title)
		assert.Equal(t, want, monthly.Rows[row][4], monthly.Title)
	}
}
