package identityaccess

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Role and permission administration (#3314): role and permission CRUD,
// account role assignment with the school identity it owes, direct account
// grants and the role-permission selection. The error messages are the wire
// contract the retained auth service established; the HTTP layers switch on
// the sentinels. System roles are immutable, and every account mutation
// serializes on the account row and, in organisation scope, on the
// account's active school membership.
var (
	// ErrRoleHoldersChanged refuses a definition change whose holder set raced its locks.
	ErrRoleHoldersChanged  = conflictError("role assignments changed; retry the role change")
	ErrSystemRoleImmutable = errors.New("system roles cannot be modified")
	ErrPermissionNotFound  = errors.New("permission not found")
	// ErrRoleNameTaken rejects a role name the school already uses (#2517).
	ErrRoleNameTaken = errors.New("role name already exists")

	// ErrRoleNotAssignable is returned when the requested role does not exist
	// (or is not a role that may be handed out for a school at all).
	ErrRoleNotAssignable = newCopyError("Die angegebene Rolle existiert nicht")
	// ErrRoleForeignTenant is returned when a tenant-scoped role belongs to a
	// different school than the one being granted.
	ErrRoleForeignTenant = newCopyError("Diese Rolle existiert an der Zielschule nicht")
	// ErrRoleGuardianNotAssignable is returned for the guardian role, which is
	// granted exclusively through the guardian invitation flow.
	ErrRoleGuardianNotAssignable = newCopyError("Sorgeberechtigten-Zugänge werden über den Einladungs-Flow für Sorgeberechtigte vergeben")
	// ErrRoleLegacyTeacherNotAssignable is returned for the retired teacher
	// role; caregiver accounts use the user role instead.
	ErrRoleLegacyTeacherNotAssignable = newCopyError("Die alte Rolle 'teacher' wird nicht mehr vergeben; bitte die Rolle 'user' verwenden")

	// ErrRoleCaregiverNeedsProfile refuses a caregiver role on a Lehrkraft
	// account: it has person and staff records but deliberately no caregiver
	// profile, so the caregiver permissions would own no groups (#1772).
	ErrRoleCaregiverNeedsProfile = errors.New("ein Lehrkraft-Konto hat kein Betreuungsprofil und kann nicht auf eine Betreuer-Rolle umgestellt werden")
	// ErrLehrkraftRoleImmutable keeps a Lehrkraft account from receiving any
	// other role. Changing it goes through offboarding plus a new account.
	ErrLehrkraftRoleImmutable = errors.New("ein Lehrkraft-Konto kann nicht umgestellt werden")
	// ErrRoleLehrkraftCaregiverProfile refuses the Lehrkraft role on an
	// account whose identity at the school still carries a live caregiver
	// profile: the swap would strand the profile and its group supervisions
	// under class_day-only permissions (#1772).
	ErrRoleLehrkraftCaregiverProfile = errors.New("das Konto hat ein Betreuungsprofil an dieser Schule und kann nicht auf Lehrkraft umgestellt werden")

	// ErrRoleAdministrationUnavailable reports a module composed without the
	// account-lifecycle dependencies the role administration needs.
	ErrRoleAdministrationUnavailable = errors.New("role administration is not composed")
)

// ValidateAssignableSchoolRole applies the school-role assignment policy to a
// resolved role. A role qualifies when it is a platform system role
// (tenant_id NULL) or a custom role of that very school. Guardian-tier roles
// belong to the guardian invitation flow and the retired teacher role is
// never handed out again. Shared by every path that grants school access, so
// the rules cannot drift apart per entry point.
func ValidateAssignableSchoolRole(role *RoleFacts, tenantID int64) error {
	if role == nil {
		return ErrRoleNotAssignable
	}
	if role.TenantID != nil && *role.TenantID != tenantID {
		return ErrRoleForeignTenant
	}
	if role.TenantID == nil && !role.IsSystem {
		return ErrRoleNotAssignable
	}
	// Guardian is decided by tier, not by name: a school role labelled
	// "Guardian" is not the parent-portal role, and the parent-portal role may
	// carry a custom label.
	if IsGuardianTierRole(role) {
		return ErrRoleGuardianNotAssignable
	}
	// The retired teacher role predates base_role and was never backfilled, so
	// it stays a name match narrowed to system roles. A school's own custom
	// "teacher" role remains assignable.
	if role.IsSystem && strings.EqualFold(strings.TrimSpace(role.Name), legacyTeacherRoleName) {
		return ErrRoleLegacyTeacherNotAssignable
	}
	return nil
}

// IsGuardianTierRole reports whether a role hands out guardian privileges.
func IsGuardianTierRole(role *RoleFacts) bool {
	return EffectiveBaseRole(role) == BaseRoleGuardian
}

// Role is one role as the administration reports it. TenantID is nil for the
// platform system roles.
type Role struct {
	ID          int64
	TenantID    *int64
	Name        string
	Description string
	IsSystem    bool
	BaseRole    *string
	// SchoolPortal marks a school role made from the Lehrkraft template: it
	// opens moto schule like the system role lehrkraft (#4574).
	SchoolPortal bool
	// TraegerRoleID names the Träger role this school role is the copy of
	// (#4810, ADR 0317); nil for a role of the school's own. The school
	// assigns a copy but does not change or delete it.
	TraegerRoleID *int64
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// RoleChange is the master data an edit of a custom role writes. A nil
// BaseRole keeps the stored one.
type RoleChange struct {
	Name        string
	Description string
	BaseRole    *string
}

// RoleVersion is the read-state token of a role's master data (ADR 0311):
// its change time. The BEFORE UPDATE trigger update_roles_updated_at sets
// updated_at on every write of the row; the permission selection lives in
// other rows and carries its own token (IDSetVersion), so saving one never
// refuses a following save of the other.
func RoleVersion(role Role) string {
	return readstate.Of(role.UpdatedAt)
}

// AssignableSchoolRole is a role the policy allows for a school, with the
// permission names the role-grant check compares against the caller's.
type AssignableSchoolRole struct {
	Role
	Permissions []string
}

// AuthorizationGrantData exposes the stored facts the role-grant policy reads.
func (r *AssignableSchoolRole) AuthorizationGrantData() (bool, string, *string, bool, bool, []string) {
	if r == nil {
		return false, "", nil, false, false, nil
	}
	return true, r.Name, r.BaseRole, r.IsSystem, r.TenantID != nil, append([]string(nil), r.Permissions...)
}

// Permission is one permission as the administration reports it.
type Permission struct {
	ID          int64
	Name        string
	Description string
	Resource    string
	Action      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// FullName is the resource:action form role details list.
func (p Permission) FullName() string {
	return p.Resource + ":" + p.Action
}

// RoleFilter narrows ListRoles. Zero values do not filter.
type RoleFilter struct {
	Name string
}

// PermissionFilter narrows ListPermissions. Zero values do not filter.
type PermissionFilter struct {
	Resource string
	Action   string
}

// RoleQuery reads roles and the roles accounts hold. Account reads apply the
// tenant in context and, in organisation scope, require the account's
// membership in that school.
type RoleQuery interface {
	GetRole(ctx context.Context, id int64) (Role, error)
	ListRoles(ctx context.Context, filter RoleFilter) ([]Role, error)
	// ResolveAssignableSchoolRole returns the role only if the school-role
	// policy allows it for tenantID. A failed lookup other than a missing
	// role is reported as is.
	ResolveAssignableSchoolRole(ctx context.Context, roleID, tenantID int64) (*AssignableSchoolRole, error)
	GetAccountRoles(ctx context.Context, accountID int64) ([]Role, error)
	// AccountsHoldingRole maps the given accounts that hold roleName at the
	// tenant in context. Accounts without that role are absent from the map.
	AccountsHoldingRole(ctx context.Context, accountIDs []int64, roleName string) (map[int64]bool, error)
	// AccountHoldsLehrkraftRole reports whether the account holds the
	// Lehrkraft system role at the tenant in context.
	AccountHoldsLehrkraftRole(ctx context.Context, accountID int64) (bool, error)
	// GetAccountRoleNames maps each account to its primary role name.
	GetAccountRoleNames(ctx context.Context, accountIDs []int64) (map[int64]string, error)
	GetAccountEmails(ctx context.Context, accountIDs []int64) (map[int64]string, error)
	GetAccountAvatars(ctx context.Context, accountIDs []int64) (map[int64]string, error)
}

// RoleCommand changes roles and account role assignments. Every assignment
// change revokes the account's sessions at the school.
type RoleCommand interface {
	// CreateRole creates a custom role of the tenant in context; baseRole maps
	// it to a system role for announcement targeting and is required. With a
	// template instead (#4574), baseRole is nil and the role starts with the
	// template system role's tier and permissions, without the platform
	// permissions. The copy is taken once; later changes to the template do
	// not reach the role.
	CreateRole(ctx context.Context, name, description string, baseRole *string, template ...RoleTemplate) (Role, error)
	// UpdateRole writes name, description and base role of a custom role
	// and answers the stored role. expectedVersion is the RoleVersion of the
	// role the change was made from; a role changed since is refused with
	// readstate.ErrChanged (ADR 0311).
	UpdateRole(ctx context.Context, id int64, change RoleChange, expectedVersion string) (Role, error)
	DeleteRole(ctx context.Context, id int64) error
	// AssignRoleToAccount assigns the role and completes the school identity
	// a staff-tier role owes, in one transaction.
	AssignRoleToAccount(ctx context.Context, accountID, roleID int64) error
	// ReplaceAccountRole makes roleID the account's only staff role at the
	// school; guardian-tier roles stay. expectedVersion is the
	// AccountRolesVersion of the roles the caller read; roles changed since
	// are refused with readstate.ErrChanged (ADR 0311).
	ReplaceAccountRole(ctx context.Context, accountID, roleID int64, expectedVersion string) error
	RemoveRoleFromAccount(ctx context.Context, accountID, roleID int64) error
}

// PermissionQuery reads permissions and role selections.
type PermissionQuery interface {
	GetPermissionByName(ctx context.Context, name string) (Permission, error)
	ListPermissions(ctx context.Context, filter PermissionFilter) ([]Permission, error)
	// GetRolePermissions reads a role's selection with its version, the
	// token ReplaceRolePermissions expects back (ADR 0311).
	GetRolePermissions(ctx context.Context, roleID int64) (RolePermissions, error)
}

// RolePermissions is a role's permission selection as one read saw it.
// Version is the read-state token of the selection (ADR 0311): opaque to
// the client, which sends it back as the expected version of a replacement.
type RolePermissions struct {
	Permissions []Permission
	Version     string
}

// PermissionCommand changes permissions and role selections. Role selections of system roles are immutable.
type PermissionCommand interface {
	AssignPermissionToRole(ctx context.Context, roleID, permissionID int64) error
	// ReplaceRolePermissions applies a complete selection atomically; an
	// invalid request leaves the current selection untouched. A reserved
	// permission the role does not hold yet is refused with
	// ErrReservedPermissionNotAllowed; one it already holds may stay or go.
	// expectedVersion is the Version of the selection the replacement was
	// made from; a selection changed since is refused with
	// readstate.ErrChanged, so nobody reverts a colleague's change unseen.
	// It answers the Version of the selection it stored.
	ReplaceRolePermissions(ctx context.Context, roleID int64, permissionIDs []int64, expectedVersion string) (string, error)
	RemovePermissionFromRole(ctx context.Context, roleID, permissionID int64) error
}

// RoleAdministration is the capability the RBAC routes, the staff membership
// runtime, operator provisioning, the caregiver capability and staff
// offboarding consume (#3314).
type RoleAdministration interface {
	RoleQuery
	RoleCommand
	PermissionQuery
	PermissionCommand
}

// SystemRoles are the system roles among roles, in their order.
func SystemRoles(roles []Role) []Role {
	result := make([]Role, 0, len(roles))
	for _, role := range roles {
		if role.IsSystem {
			result = append(result, role)
		}
	}
	return result
}

// PlatformSystemRole finds the platform system role with that name,
// matching case-insensitively; a school's own role never matches.
func PlatformSystemRole(roles []Role, name string) (Role, bool) {
	for _, role := range roles {
		if role.IsSystem && role.TenantID == nil && strings.EqualFold(role.Name, name) {
			return role, true
		}
	}
	return Role{}, false
}

// IDSetVersion is the read-state token of a set of IDs (ADR 0311): the
// fingerprint of the IDs in ascending order, so the order a store returns
// them in does not change it. A role's permission selection and the roles
// an account holds at one school both use it.
func IDSetVersion(ids []int64) string {
	// Never nil, so no IDs and an empty read give one token.
	sorted := append(make([]int64, 0, len(ids)), ids...)
	slices.Sort(sorted)
	return readstate.Fingerprint(sorted)
}

// AccountRolesVersion is the read-state token of the roles an account holds
// at one school, guardian-tier roles included. The school's role read and
// ReplaceAccountRole's check, the operator's access listing and its role
// change derive it from the same assignments.
func AccountRolesVersion(roles []Role) string {
	ids := make([]int64, 0, len(roles))
	for _, role := range roles {
		ids = append(ids, role.ID)
	}
	return IDSetVersion(ids)
}
