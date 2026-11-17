//go:build testhooks

package api

import (
	"log/slog"
	"time"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// StaffTestModule is the People Directory side of the staff routes: the
// person directory and the owner capability, with the staff membership
// runtime composed over them.
type StaffTestModule struct {
	Users             peoplePorts.PersonDirectory
	PeopleDirectory   peopledirectory.Capability
	membershipRuntime func(transactionruntime.Database, *slog.Logger, StaffMembershipHooks) StaffMembershipRuntime
}

func (m StaffTestModule) NewStaffMembershipRuntime(db transactionruntime.Database, logger *slog.Logger, hooks StaffMembershipHooks) StaffMembershipRuntime {
	return m.membershipRuntime(db, logger, hooks)
}

// NewStaffTestModule composes the staff routes' People Directory side and
// returns it with the Workforce owner the routes administer staff through.
func NewStaffTestModule(db transactionruntime.Database, unit tenant.UnitOfWork) (StaffTestModule, WorkforceTestModule, error) {
	return NewStaffTestModuleWithClock(db, unit, time.Now)
}

// NewStaffTestModuleWithClock is NewStaffTestModule with the staff
// offboarding and its planned exits on the clock now.
func NewStaffTestModuleWithClock(db transactionruntime.Database, unit tenant.UnitOfWork, now func() time.Time) (StaffTestModule, WorkforceTestModule, error) {
	work, users, err := NewWorkforceTestModule(db, unit)
	if err != nil {
		return StaffTestModule{}, WorkforceTestModule{}, err
	}
	auth, err := NewAuthTestModule(db, unit)
	if err != nil {
		return StaffTestModule{}, WorkforceTestModule{}, err
	}
	groups, _, _, _, err := NewGroupsTestModule(db, unit)
	if err != nil {
		return StaffTestModule{}, WorkforceTestModule{}, err
	}
	people, err := owners.NewPeopleDirectory(db)
	if err != nil {
		return StaffTestModule{}, WorkforceTestModule{}, err
	}
	membershipRuntime := func(db transactionruntime.Database, logger *slog.Logger, hooks StaffMembershipHooks) StaffMembershipRuntime {
		return NewStaffMembershipRuntime(users, groups.Education, work.TimeTracking.StaffDay, nil, db, auth.Auth, logger, hooks, now)
	}
	return StaffTestModule{Users: users, PeopleDirectory: people, membershipRuntime: membershipRuntime}, work, nil
}
