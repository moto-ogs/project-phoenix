package postgres

import (
	"reflect"
	"strings"
	"testing"
)

// TestStaffDayRowsDecodeEveryColumn guards the JSON read of the staff day
// (#7903): every column of the two rows needs a json tag of the same name,
// or json_agg's key would leave the field silently zero.
func TestStaffDayRowsDecodeEveryColumn(t *testing.T) {
	t.Parallel()
	for _, row := range []any{staffAbsenceRow{}, groupSubstitutionRow{}} {
		rowType := reflect.TypeOf(row)
		for i := 0; i < rowType.NumField(); i++ {
			field := rowType.Field(i)
			column, _, _ := strings.Cut(field.Tag.Get("bun"), ",")
			if field.Anonymous || column == "" {
				continue
			}
			if got := field.Tag.Get("json"); got != column {
				t.Errorf("%s.%s: json tag %q, want the column %q", rowType.Name(), field.Name, got, column)
			}
		}
	}
}
