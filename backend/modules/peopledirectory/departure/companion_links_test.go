package departure

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestFormatCompanionLinks pins the offline-list rendering: names carry the
// weekdays unless the link covers the whole week, so a Monday-only
// Laufgemeinschaft cannot be read off a paper list as a standing arrangement.
func TestFormatCompanionLinks(t *testing.T) {
	t.Parallel()

	got := FormatCompanionLinks([]CompanionLink{
		{CompanionStudentID: 7, FirstName: "Mia", LastName: "Schulz", Weekdays: []string{PickupDayMonday, PickupDayTuesday}},
		{CompanionStudentID: 9, FirstName: "Tom", LastName: "Meier", Weekdays: PickupDayOrder},
	})
	if want := "Mia Schulz (Mo, Di), Tom Meier"; got != want {
		t.Errorf("FormatCompanionLinks = %q, want %q", got, want)
	}

	if got := FormatCompanionLinks(nil); got != "" {
		t.Errorf("empty render = %q, want \"\"", got)
	}

	// A link whose names were not joined in still names the child by id rather
	// than rendering an empty "(Mo)".
	if got, want := FormatCompanionLinks([]CompanionLink{
		{CompanionStudentID: 12, Weekdays: []string{PickupDayMonday}},
	}), "Kind #12 (Mo)"; got != want {
		t.Errorf("nameless render = %q, want %q", got, want)
	}
}

// TestCompanionDaysFromLinks folds the submitted list into the cover set the
// model checks against, which is what lets a caller vouch for edges it is about
// to write in the same transaction.
func TestCompanionDaysFromLinks(t *testing.T) {
	t.Parallel()

	days := CompanionDaysFromLinks([]CompanionLink{
		{CompanionStudentID: 11, Weekdays: []string{PickupDayMonday}},
		{CompanionStudentID: 12, Weekdays: []string{PickupDayMonday, PickupDayThursday}},
	})

	require.Equal(t, map[string]bool{PickupDayMonday: true, PickupDayThursday: true}, days)
	require.Empty(t, CompanionDaysFromLinks(nil))
}
