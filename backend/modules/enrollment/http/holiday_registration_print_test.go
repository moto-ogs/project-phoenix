package enrollmenthttp

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// The printed list of the holiday registrations keeps the columns the list
// on site needs; contact details beyond the phone and the answers to the
// form stay in Excel and CSV (#4718).
func TestHolidayRegistrationPrintColumnsLeaveContactDetailsAndAnswersOut(t *testing.T) {
	t.Parallel()
	all := holidayExportColumns([]capability.HolidayFormField{{Key: "swimmer", Label: "Kann schwimmen"}})
	printed := holidayRegistrationPrintColumns(all)
	ids := make([]lists.ColumnID, len(printed))
	for i, column := range printed {
		ids[i] = column.ID
	}
	assert.Equal(t, []lists.ColumnID{
		"status", "registration", "last_name", "first_name", "birth_date", "school", "week",
		"host_school", "time_model", "lunch", "guardian", "phone",
	}, ids, "in the order of the export")
	assert.Len(t, all, len(holidayRegistrationColumns)+1, "Excel and CSV keep every column and the answer")
}
