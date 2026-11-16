//go:build testhooks

package api

import (
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	arrivalTimetable "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewTimetableTestDeviations binds Timetable's deviation writes over db with
// the given dependencies and the pool's day locks, the way the composition
// root binds them. A suite outside Timetable uses it to wire a collaborator
// the test module leaves out, such as the staffing notices (#7136).
func NewTimetableTestDeviations(db transactionruntime.Database, deps timetablePorts.StaffDeviationDependencies) (timetable.StaffDeviations, error) {
	deps.Locks = arrivalTimetable.NewTenantDatabase(db.Pool())
	return arrivalTimetable.NewStaffDeviations(deps)
}
