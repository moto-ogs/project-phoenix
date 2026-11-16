package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
)

var (
	errSpringerAccessUnavailable = errors.New("identity access: springer access is not composed")
	// errSpringerAccessOutsideUnit: both commands join the blocking school's
	// tenant transaction and never open one.
	errSpringerAccessOutsideUnit = errors.New("identity access: springer access needs the caller's tenant transaction")
	// errSpringerRoleMissing: migration 20261115230000 creates the role, so
	// this is a broken deployment, not a request error.
	errSpringerRoleMissing = errors.New("identity access: system role springer missing")
)

// SpringerAccess gives a Springer access to a school only in the times a
// school blocked them (#7173, ADR 0251). Its commands run in the blocking
// school's tenant transaction, so they commit or roll back with the block.
type SpringerAccess struct {
	roles    ports.RoleStore
	windows  ports.SpringerAccessStore
	identity ports.SchoolIdentity
	runtime  ports.Runtime
	attach   func(context.Context) context.Context
}

// NewSpringerAccess composes the Springer access over the school identity
// chain; without the account lifecycle it is nil and reports itself
// unavailable.
func NewSpringerAccess(roles ports.RoleStore, windows ports.SpringerAccessStore, identity *AccountLifecycle, runtime ports.Runtime, attach func(context.Context) context.Context) *SpringerAccess {
	if identity == nil {
		return nil
	}
	return &SpringerAccess{roles: roles, windows: windows, identity: identity, runtime: runtime, attach: attach}
}

var _ identityaccess.SpringerAccess = (*SpringerAccess)(nil)

// GrantSpringerWindow creates what the window needs at the school of the
// caller's tenant transaction, each step only when it is missing. The
// account lock serializes it with role assignments and revocations.
func (s *SpringerAccess) GrantSpringerWindow(ctx context.Context, window identityaccess.SpringerWindow) (employment identityaccess.SpringerEmployment, err error) {
	if s == nil {
		return employment, errSpringerAccessUnavailable
	}
	if !window.EndsAt.After(window.StartsAt) {
		return employment, identityaccess.ErrSpringerAccessWindowInvalid
	}
	txCtx, tenantID, err := s.unit(ctx)
	if err != nil {
		return employment, err
	}
	identity, err := s.employ(txCtx, tenantID, window)
	if err != nil {
		return employment, err
	}
	employment = identityaccess.SpringerEmployment{PersonID: identity.PersonID, StaffID: identity.StaffID}
	return employment, s.windows.SaveAccessWindow(txCtx, window.AccountID, tenantID, window.BlockID, window.StartsAt, window.EndsAt)
}

// unit binds the composed runtime and requires the caller's tenant
// transaction of one school.
func (s *SpringerAccess) unit(ctx context.Context) (context.Context, int64, error) {
	txCtx := bindRuntime(s.attach, ctx)
	if !s.runtime.HasTransaction(txCtx) {
		return nil, 0, errSpringerAccessOutsideUnit
	}
	tenantID := s.runtime.TenantID(txCtx)
	if tenantID <= 0 {
		return nil, 0, domain.ErrTenantRequired
	}
	return txCtx, tenantID, nil
}

// employ maps the account, assigns the role and completes person
// and employment, resuming a former employment (ADR 0021).
func (s *SpringerAccess) employ(ctx context.Context, tenantID int64, window identityaccess.SpringerWindow) (*domain.SchoolIdentity, error) {
	found, err := s.roles.LockAccount(ctx, window.AccountID)
	if err != nil {
		return nil, fmt.Errorf("lock springer account: %w", err)
	}
	if !found {
		return nil, identityaccess.ErrAccountNotFound
	}
	if err := s.windows.EnsureSpringerAccountTenant(ctx, window.AccountID, tenantID); err != nil {
		return nil, err
	}
	role, found, err := s.roles.FindSystemRoleByName(ctx, identityaccess.SpringerRoleName)
	if err != nil {
		return nil, fmt.Errorf("find springer role: %w", err)
	}
	if !found {
		return nil, errSpringerRoleMissing
	}
	holds, err := s.roles.AccountHoldsRole(ctx, window.AccountID, role.ID)
	if err != nil {
		return nil, fmt.Errorf("read springer role: %w", err)
	}
	if !holds {
		if err := s.roles.CreateAccountRole(ctx, window.AccountID, role.ID, tenantID); err != nil {
			return nil, fmt.Errorf("assign springer role: %w", err)
		}
	}
	identity, err := s.identity.EnsureSchoolIdentityChain(ctx, domain.SchoolIdentityInput{
		AccountID: window.AccountID, TenantID: tenantID, Role: role.Facts(),
		FirstName: window.FirstName, LastName: window.LastName,
		EmploymentAction: domain.EmploymentActionResume, CreatePerson: true,
	})
	if err != nil {
		return nil, fmt.Errorf("provision springer identity: %w", err)
	}
	if identity == nil {
		return nil, errors.New("identity access: the springer role owes no employment")
	}
	return identity, nil
}

// EndSpringerWindow deletes the window of a lifted block.
func (s *SpringerAccess) EndSpringerWindow(ctx context.Context, blockID int64) error {
	if s == nil {
		return errSpringerAccessUnavailable
	}
	// The lift's own tenant transaction, never one of its own.
	txCtx := bindRuntime(s.attach, ctx)
	if !s.runtime.HasTransaction(txCtx) {
		return errSpringerAccessOutsideUnit
	}
	tenantID := s.runtime.TenantID(txCtx)
	if tenantID <= 0 {
		return domain.ErrTenantRequired
	}
	return s.windows.DeleteAccessWindow(txCtx, tenantID, blockID)
}

// PruneSpringerWindows deletes the ended windows at the school of the
// caller's tenant transaction. An ended window admits no one, so this only
// keeps the mappings small (#7197).
func (s *SpringerAccess) PruneSpringerWindows(ctx context.Context) error {
	if s == nil {
		return errSpringerAccessUnavailable
	}
	// The Worker's unit of the school, never one of its own.
	txCtx := bindRuntime(s.attach, ctx)
	if !s.runtime.HasTransaction(txCtx) {
		return errSpringerAccessOutsideUnit
	}
	tenantID := s.runtime.TenantID(txCtx)
	if tenantID <= 0 {
		return domain.ErrTenantRequired
	}
	return s.windows.PruneAccessWindows(txCtx, tenantID)
}

// HoldsOnlySpringerAccess reports whether the account holds at the school
// of the caller's tenant transaction no role but springer and guardian:
// the roles auth.account_tenant_admitted limits to windows (#7197).
func (s *SpringerAccess) HoldsOnlySpringerAccess(ctx context.Context, accountID int64) (bool, error) {
	if s == nil {
		return false, errSpringerAccessUnavailable
	}
	if accountID <= 0 {
		return false, identityaccess.ErrAccountNotFound
	}
	txCtx, tenantID, err := s.unit(ctx)
	if err != nil {
		return false, err
	}
	only, err := s.windows.HoldsOnlySpringerRoles(txCtx, accountID, tenantID, identityaccess.SpringerRoleName)
	if err != nil {
		return false, fmt.Errorf("read springer roles: %w", err)
	}
	return only, nil
}
