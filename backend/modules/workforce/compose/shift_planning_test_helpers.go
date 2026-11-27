//go:build testhooks

package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/planning"
)

type StaffScheduleOverviewDependencies = planning.StaffScheduleOverviewDependencies

// NewStaffScheduleOverview builds suites' week-grid reader; production uses NewShiftPlanning.
// Its public values use string dates and ClockLayout wall clocks, not row models.
func NewStaffScheduleOverview(deps StaffScheduleOverviewDependencies) workforce.StaffScheduleOverviewQuery {
	return planning.NewStaffScheduleOverviewQuery(planning.NewStaffScheduleOverviewService(deps))
}
