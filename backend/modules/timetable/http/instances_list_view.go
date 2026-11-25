package timetablehttp

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// Values of the `view` query parameter of GET /instances.
const (
	// instanceListViewFull is the historical projection and stays the
	// default, so every existing consumer keeps its payload.
	instanceListViewFull = "full"
	// instanceListViewSlim drops the per-child attendance rows (#4996). They
	// are about half of a week's payload, and the Betreuungsplan grid renders
	// none of them: the detail panel reads only the opened block.
	instanceListViewSlim = "slim"
)

// parseInstanceListView resolves the `view` query parameter. An unknown value
// is rejected instead of silently serving the full payload.
func parseInstanceListView(value string) (timetable.PlannerProjection, error) {
	switch value {
	case "", instanceListViewFull:
		return timetable.PlannerFull, nil
	case instanceListViewSlim:
		return timetable.PlannerGrid, nil
	default:
		return timetable.PlannerGrid, fmt.Errorf("invalid view %q: must be %q or %q", value, instanceListViewFull, instanceListViewSlim)
	}
}
