package timetablehttp

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// templateReadVersion answers the segment's token (ADR 0311): the Timetable
// owner's ReadTemplateSeriesVersion, the read its update and split check
// under their recurrence gate. A segment the read no longer returns has the
// token of no state.
func (rs *Resource) templateReadVersion(ctx context.Context, templateID int64) (string, error) {
	version, _, err := timetable.ReadTemplateSeriesVersion(ctx, rs.TimetableData, templateID)
	return version, err
}
