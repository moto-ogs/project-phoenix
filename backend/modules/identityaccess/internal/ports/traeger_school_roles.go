package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

// TraegerSchoolRoleStore persists the roles a Träger gives its schools
// (#4810, ADR 0317). The first block runs in the Träger transaction of the
// named Träger and refuses every other unit; the second reads and writes the
// copies in the school of the tenant transaction.
type TraegerSchoolRoleStore interface {
	ListTraegerSchoolRoles(ctx context.Context, organizationID int64) ([]domain.TraegerSchoolRole, error)
	// FindTraegerSchoolRole reads one role; lock holds its row until the
	// transaction ends.
	FindTraegerSchoolRole(ctx context.Context, organizationID, id int64, lock bool) (domain.TraegerSchoolRole, bool, error)
	// SaveTraegerSchoolRole inserts the role (ID zero) or rewrites it with
	// its selection. A selected permission the catalog no longer holds is
	// skipped; the answer carries the stored selection.
	SaveTraegerSchoolRole(ctx context.Context, role domain.TraegerSchoolRole) (domain.TraegerSchoolRole, error)
	DeleteTraegerSchoolRole(ctx context.Context, organizationID, id int64) error
	// PlatformRoleNameExists reports a platform system role of that name.
	PlatformRoleNameExists(ctx context.Context, organizationID int64, name string) (bool, error)
	// SchoolPermissionCatalog lists every permission of the catalog.
	SchoolPermissionCatalog(ctx context.Context, organizationID int64) ([]domain.ManagedPermission, error)
	// PlatformRolePermissionIDs lists what the platform system role holds.
	PlatformRolePermissionIDs(ctx context.Context, organizationID int64, roleName string) ([]int64, error)

	// SchoolRoleStates lists the school's own roles and its copies of
	// Träger roles, each with the number of accounts that hold it.
	SchoolRoleStates(ctx context.Context) ([]domain.SchoolRoleState, error)
	// CountRoleInvitations counts the school's invitations that name the
	// role, redeemed and expired ones included: each blocks its deletion.
	CountRoleInvitations(ctx context.Context, roleID int64) (int, error)
	// ReleaseTraegerRoleCopy turns the copy into a role of the school's own.
	ReleaseTraegerRoleCopy(ctx context.Context, roleID int64) error
}
