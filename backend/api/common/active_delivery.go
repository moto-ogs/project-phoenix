package common

import (
	"context"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
)

func RequireActiveGroupRead() Middleware   { return RequiresPermission(permissions.GroupsRead) }
func RequireActiveGroupUpdate() Middleware { return RequiresPermission(permissions.GroupsUpdate) }
func RequireVisitUpdate() Middleware       { return RequiresPermission(permissions.VisitsUpdate) }

// RequireSchoolCheckin guards the app's check-in into a room or activity
// (#6953), which also needs RequireVisitUpdate for the placement.
func RequireSchoolCheckin() Middleware { return RequiresPermission(permissions.UsersCheckin) }

// CanUseSchoolWideAttendance checks the request identity only; the attendance
// service still evaluates tenant settings and resource-level access.
func CanUseSchoolWideAttendance(ctx context.Context, staffTenantID, requestTenantID int64) bool {
	principal, err := CurrentPrincipal(ctx)
	ogsScope := principal.Scope() == permissions.ScopeTenant || principal.Scope() == permissions.ScopeOrganization
	return err == nil && ogsScope && principal.AccountID() > 0 && principal.TenantID() > 0 &&
		principal.TenantID() == requestTenantID && staffTenantID == principal.TenantID() &&
		HasPermission(permissions.VisitsUpdate, principal.Permissions())
}
