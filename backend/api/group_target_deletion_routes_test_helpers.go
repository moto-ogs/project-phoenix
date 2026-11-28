//go:build testhooks

package api

import (
	"net/http"

	schoolstructurehttp "github.com/moto-ogs/project-phoenix/modules/schoolstructure/http"
	activitiesAPI "github.com/moto-ogs/project-phoenix/modules/timetable/http/activities"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// GroupTargetDeletionRoutes are the production routes that delete the
// targets of a group thread (#8213): School Structure's group routes and the
// Timetable's AG routes, for suites that may import neither owner. Mount
// Groups at /groups and Activities at /activities.
type GroupTargetDeletionRoutes struct {
	Groups     http.Handler
	Activities http.Handler
}

// NewGroupTargetDeletionRoutesForTests builds both route resources over the
// test database, as the production router mounts them.
func NewGroupTargetDeletionRoutesForTests(db transactionruntime.Database, unit tenant.UnitOfWork) (GroupTargetDeletionRoutes, error) {
	structure, _, people, _, err := NewGroupsTestModule(db, unit)
	if err != nil {
		return GroupTargetDeletionRoutes{}, err
	}
	module, activities, users, caller, err := NewActivitiesTestModule(db)
	if err != nil {
		return GroupTargetDeletionRoutes{}, err
	}
	return GroupTargetDeletionRoutes{
		Groups: schoolstructurehttp.NewResource(structure.Education, people.People, transactionFailures.IsConstraintViolation).Router(ProtectedTenantRoutes),
		Activities: activitiesAPI.NewResource(activities, module.Timetable, NewTimetableSupervisorDirectory(users), caller, TimetableHTTPTransactions).
			Router(ProtectedTenantRoutes),
	}, nil
}
