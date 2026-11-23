package behaviortest_test

import (
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// sessionGroups returns the session repository behind the composed session
// records of a repository factory.
func sessionGroups(records studentpresence.SessionRecords) ports.ActiveGroupRepository {
	groups, _ := presenceCompose.SessionRepositories(records)
	return groups
}

// sessionSupervisors returns the supervision repository behind the composed
// session records of a repository factory.
func sessionSupervisors(records studentpresence.SessionRecords) ports.GroupSupervisorRepository {
	_, supervisors := presenceCompose.SessionRepositories(records)
	return supervisors
}

// supervisorOf copies a stored fixture supervision into the value the
// service reads and writes.
func supervisorOf(row *testpkg.GroupSupervisorRow) *ports.GroupSupervisor {
	return &ports.GroupSupervisor{
		ID: ident.ID(row.ID), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, TenantID: ident.ID(row.TenantID),
		StaffID: ident.ID(row.StaffID), GroupID: ident.ID(row.GroupID), Role: row.Role, StartDate: row.StartDate, EndDate: row.EndDate,
	}
}
