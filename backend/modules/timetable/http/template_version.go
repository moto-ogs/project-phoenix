package timetablehttp

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// templateReadVersion answers the segment's token, the Timetable owner's
// TemplateSeriesVersion (ADR 0311) over the reads the owner's update and
// split take it from under their recurrence gate: the period-free template
// entries and the weekday roster of the template's planning period. A
// segment the read no longer returns has the token of no state.
func (rs *Resource) templateReadVersion(ctx context.Context, templateID int64) (string, error) {
	entries, err := rs.TimetableData.ListTemplateEntries(ctx, &templateID, rs.childrenPerStaffRatio(ctx))
	if err != nil {
		return "", err
	}
	var periodID *int64
	if len(entries) > 0 {
		periodID = entries[0].TemplateCalendarPeriodID
	}
	roster, err := rs.TimetableData.ListTemplateWeekdayRoster(ctx, &templateID, periodID)
	if err != nil {
		return "", err
	}
	return timetable.TemplateSeriesVersion(entries, roster), nil
}
