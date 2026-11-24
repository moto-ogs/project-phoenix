package workforce

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ScheduleVersionRow is one row of a staff member's running schedule
// version in the canonical spelling of ScheduleVersion: clock times in
// ClockLayout, calendar days as YYYY-MM-DD, empty when unset.
type ScheduleVersionRow struct {
	WeekIndex          int
	RotationLength     int
	DayOfWeek          int
	TargetMinutes      int
	StartTime          string
	RotationAnchorDate string
	ValidFrom          string
}

// ScheduleVersion is the token of the schedule form (ADR 0311): the work
// time model the staff member is bound to, the staff-level rotation anchor
// and the rows of the running schedule version. The GET of the schedule
// answers it and the schedule PUT compares it under the staff member's
// balance gate, which every schedule writer takes.
func ScheduleVersion(workTimeModelID *int64, rotationAnchorDate string, rows []ScheduleVersionRow) string {
	sorted := slices.Clone(rows)
	slices.SortFunc(sorted, func(a, b ScheduleVersionRow) int {
		if a.WeekIndex != b.WeekIndex {
			return a.WeekIndex - b.WeekIndex
		}
		return a.DayOfWeek - b.DayOfWeek
	})
	if sorted == nil {
		sorted = []ScheduleVersionRow{}
	}
	var model int64
	if workTimeModelID != nil {
		model = *workTimeModelID
	}
	return readstate.Fingerprint(struct {
		Model  int64
		Anchor string
		Rows   []ScheduleVersionRow
	}{model, rotationAnchorDate, sorted})
}
