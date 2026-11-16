package api

import (
	"time"

	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
)

// newCalendarPeriodUsage answers the School Calendar deletion preview's
// per-period reference counts from Enrollment's phases and the planning
// owner's tables, one statement each (#3124). No root clock reaches it, so it
// binds the real one explicitly (ADR 0265).
func newCalendarPeriodUsage(planning timetable.Capability) timetablePorts.CalendarPeriodUsageRepository {
	return timetableCompose.NewPlanningCalendarPeriodUsage(enrollmentCompose.NewClocked(time.Now), planning)
}
