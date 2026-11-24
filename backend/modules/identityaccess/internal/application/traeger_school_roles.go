package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The roles a Träger gives the staff of all its schools (#4810, ADR 0317).
// The Träger-Büro keeps a role in the Träger transaction; afterwards Identity
// & Access carries it into every school of the Träger, each in its own tenant
// transaction (ADR 0084 section 2, ADR 0105). A school that fails keeps its
// previous state and shows as not carried; the next change of the role tries
// it again. A school that joins the Träger later gets its copies from the
// trigger of the migration.

// TraegerSchoolRoles runs the Träger roles over the role administration's
// store, locks and session revocation.
type TraegerSchoolRoles struct {
	roles  *RoleAdministration
	store  ports.TraegerSchoolRoleStore
	audit  ports.AuthAudit
	ports  identityaccess.TraegerSchoolRolePorts
	logger *slog.Logger
}

var _ identityaccess.TraegerSchoolRoles = (*TraegerSchoolRoles)(nil)

// TraegerSchoolRoles builds the capability over the root's bindings
// (identityaccess.TraegerSchoolRoleProvider).
func (e engine) TraegerSchoolRoles(collaborators identityaccess.TraegerSchoolRolePorts) (identityaccess.TraegerSchoolRoles, error) {
	if e.RoleAdministration == nil || e.AccountAuthentication == nil {
		return nil, identityaccess.ErrTraegerSchoolRolesUnavailable
	}
	store, ok := e.RoleAdministration.store.(ports.TraegerSchoolRoleStore)
	if !ok {
		return nil, identityaccess.ErrTraegerSchoolRolesUnavailable
	}
	if collaborators.Schools == nil || collaborators.Runtime == nil || collaborators.People == nil {
		return nil, errors.New("identity access traeger school roles: schools, runtime and people are required")
	}
	return &TraegerSchoolRoles{
		roles: e.RoleAdministration, store: store, audit: e.AccountAuthentication.audit, ports: collaborators, logger: e.RoleAdministration.logger,
	}, nil
}

// traegerRoleVersion is the read-state token of a Träger role: every save
// rewrites its row, so its change time covers the selection too.
func traegerRoleVersion(role domain.TraegerSchoolRole) string {
	return readstate.Of(role.UpdatedAt)
}

// alone serializes the writes of one Träger's roles across their Träger
// transaction and every school's transaction: a slower save cannot write
// its older state into a school after a newer one, and a save cannot
// recreate a copy while a removal walks the schools.
func (t *TraegerSchoolRoles) alone(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, fn func(context.Context) error) error {
	return t.ports.Runtime.WithinExclusive(ctx, fmt.Sprintf("traeger-school-roles:%d", actor.OrganizationID), fn)
}

func (t *TraegerSchoolRoles) inTraeger(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, fn func(context.Context) error) error {
	return t.ports.Runtime.WithinTraeger(ctx, actor.OrganizationID, fn)
}

// inSchool runs fn in the school's tenant transaction with the role
// store bound to it.
func (t *TraegerSchoolRoles) inSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error {
	return t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		return fn(bindRuntime(t.roles.attach, ctx))
	})
}

// ListTraegerSchoolRoles lists the roles with how each school carries them.
func (t *TraegerSchoolRoles) ListTraegerSchoolRoles(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor) (identityaccess.TraegerSchoolRoleList, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return identityaccess.TraegerSchoolRoleList{}, err
	}
	var roles []domain.TraegerSchoolRole
	err = t.inTraeger(ctx, actor, func(ctx context.Context) error {
		var err error
		roles, err = t.store.ListTraegerSchoolRoles(ctx, actor.OrganizationID)
		return err
	})
	if err != nil {
		return identityaccess.TraegerSchoolRoleList{}, err
	}
	states, err := t.schoolStates(ctx, schools)
	if err != nil {
		return identityaccess.TraegerSchoolRoleList{}, err
	}
	list := identityaccess.TraegerSchoolRoleList{Schools: schools, Roles: make([]identityaccess.TraegerSchoolRole, 0, len(roles))}
	for _, role := range roles {
		list.Roles = append(list.Roles, publicTraegerSchoolRole(role, schools, states))
	}
	return list, nil
}

// schoolStates reads the roles of every school, each in its own tenant
// transaction.
func (t *TraegerSchoolRoles) schoolStates(ctx context.Context, schools []identityaccess.TraegerSchoolRoleSchool) (map[int64][]domain.SchoolRoleState, error) {
	result := make(map[int64][]domain.SchoolRoleState, len(schools))
	for _, school := range schools {
		err := t.inSchool(ctx, school.ID, func(ctx context.Context) error {
			states, err := t.store.SchoolRoleStates(ctx)
			result[school.ID] = states
			return err
		})
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

func publicTraegerSchoolRole(role domain.TraegerSchoolRole, schools []identityaccess.TraegerSchoolRoleSchool, states map[int64][]domain.SchoolRoleState) identityaccess.TraegerSchoolRole {
	result := identityaccess.TraegerSchoolRole{
		ID: role.ID, Name: role.Name, Description: role.Description, BaseRole: role.BaseRole,
		PermissionIDs: append([]int64{}, role.PermissionIDs...), UpdatedAt: role.UpdatedAt, Version: traegerRoleVersion(role),
		Schools: make([]identityaccess.TraegerSchoolRoleCarry, 0, len(schools)),
	}
	for _, school := range schools {
		result.Schools = append(result.Schools, schoolCarry(role, school, states[school.ID]))
	}
	return result
}

// schoolCarry reads how one school carries the role: through its copy, or
// not at all because a role of its own has the name.
func schoolCarry(role domain.TraegerSchoolRole, school identityaccess.TraegerSchoolRoleSchool, states []domain.SchoolRoleState) identityaccess.TraegerSchoolRoleCarry {
	carry := identityaccess.TraegerSchoolRoleCarry{SchoolID: school.ID, SchoolName: school.Name}
	for _, state := range states {
		switch {
		case state.TraegerRoleID != nil && *state.TraegerRoleID == role.ID:
			carry.Carried, carry.Holders = state.Carries(role), state.Holders
		case state.TraegerRoleID == nil && state.Name == role.CopyName():
			carry.NameTaken = true
		}
	}
	return carry
}

// TraegerSchoolRoleCatalog lists the permissions a school role may hold and
// the starting selections of the two tiers.
func (t *TraegerSchoolRoles) TraegerSchoolRoleCatalog(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor) (identityaccess.TraegerSchoolRoleCatalog, error) {
	var catalog identityaccess.TraegerSchoolRoleCatalog
	err := t.inTraeger(ctx, actor, func(ctx context.Context) error {
		all, err := t.store.SchoolPermissionCatalog(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		caregiver, err := t.store.PlatformRolePermissionIDs(ctx, actor.OrganizationID, domain.BaseRoleUser)
		if err != nil {
			return err
		}
		catalog = traegerRoleCatalog(all, caregiver)
		return nil
	})
	return catalog, err
}

// traegerRoleCatalog drops the reserved platform permissions (#4574) and
// builds the starting selections as the school's templates do: Verwaltung is
// the whole catalog, Betreuung what the platform role holds; a permission a
// school grants only on purpose is in neither.
func traegerRoleCatalog(all []domain.ManagedPermission, caregiverIDs []int64) identityaccess.TraegerSchoolRoleCatalog {
	catalog := identityaccess.TraegerSchoolRoleCatalog{Permissions: make([]identityaccess.Permission, 0, len(all))}
	administration, caregiver := []int64{}, []int64{}
	for _, permission := range all {
		name := permissionKey(permission)
		if identityaccess.IsReservedPermission(name) {
			continue
		}
		catalog.Permissions = append(catalog.Permissions, identityaccess.Permission(permission))
		if identityaccess.IsExplicitGrantPermission(name) {
			continue
		}
		administration = append(administration, permission.ID)
		if slices.Contains(caregiverIDs, permission.ID) {
			caregiver = append(caregiver, permission.ID)
		}
	}
	catalog.Templates = []identityaccess.TraegerSchoolRoleTemplate{
		{BaseRole: domain.BaseRoleUser, PermissionIDs: caregiver},
		{BaseRole: domain.AdminRoleName, PermissionIDs: administration},
	}
	return catalog
}

// CreateTraegerSchoolRole stores a new role and carries it into every school.
func (t *TraegerSchoolRoles) CreateTraegerSchoolRole(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, input identityaccess.TraegerSchoolRoleInput) (identityaccess.TraegerSchoolRole, error) {
	role := traegerSchoolRoleOf(actor.OrganizationID, 0, input)
	if err := invalidTraegerSchoolRole(role); err != nil {
		return identityaccess.TraegerSchoolRole{}, err
	}
	var saved identityaccess.TraegerSchoolRole
	err := t.alone(ctx, actor, func(ctx context.Context) error {
		schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		if err := t.refuseNameOfSchoolRole(ctx, schools, role); err != nil {
			return err
		}
		err = t.inTraeger(ctx, actor, func(ctx context.Context) error {
			if err := t.requireStorable(ctx, role); err != nil {
				return err
			}
			role, err = t.store.SaveTraegerSchoolRole(ctx, role)
			return err
		})
		if err != nil {
			return err
		}
		saved = t.carry(ctx, actor, role, schools)
		return nil
	})
	return saved, err
}

// UpdateTraegerSchoolRole rewrites a role and carries it into every school.
// A role changed since the form read it is refused (ADR 0311) under the row
// lock the write takes.
func (t *TraegerSchoolRoles) UpdateTraegerSchoolRole(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, id int64, input identityaccess.TraegerSchoolRoleInput) (identityaccess.TraegerSchoolRole, error) {
	role := traegerSchoolRoleOf(actor.OrganizationID, id, input)
	if err := invalidTraegerSchoolRole(role); err != nil {
		return identityaccess.TraegerSchoolRole{}, err
	}
	var saved identityaccess.TraegerSchoolRole
	err := t.alone(ctx, actor, func(ctx context.Context) error {
		schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
		if err != nil {
			return err
		}
		current, err := t.readTraegerRole(ctx, actor, id, input.ExpectedVersion)
		if err != nil {
			return err
		}
		if current.CopyName() != role.CopyName() {
			if err := t.refuseNameOfSchoolRole(ctx, schools, role); err != nil {
				return err
			}
		}
		if role, err = t.rewriteTraegerRole(ctx, actor, role, input.ExpectedVersion); err != nil {
			return err
		}
		saved = t.carry(ctx, actor, role, schools)
		return nil
	})
	return saved, err
}

// rewriteTraegerRole stores the role over the version the form read, under
// the row lock: after a wait the row comes back as committed.
func (t *TraegerSchoolRoles) rewriteTraegerRole(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, role domain.TraegerSchoolRole, expectedVersion string) (domain.TraegerSchoolRole, error) {
	err := t.inTraeger(ctx, actor, func(ctx context.Context) error {
		locked, found, err := t.store.FindTraegerSchoolRole(ctx, actor.OrganizationID, role.ID, true)
		if err != nil {
			return err
		}
		if !found {
			return identityaccess.ErrTraegerSchoolRoleNotFound
		}
		if err := readstate.Check(expectedVersion, traegerRoleVersion(locked)); err != nil {
			return err
		}
		if err := t.requireStorable(ctx, role); err != nil {
			return err
		}
		role, err = t.store.SaveTraegerSchoolRole(ctx, role)
		return err
	})
	return role, err
}

// readTraegerRole reads the role the change was made from and refuses a
// stale form before any school is read.
func (t *TraegerSchoolRoles) readTraegerRole(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, id int64, expectedVersion string) (domain.TraegerSchoolRole, error) {
	var current domain.TraegerSchoolRole
	err := t.inTraeger(ctx, actor, func(ctx context.Context) error {
		role, found, err := t.store.FindTraegerSchoolRole(ctx, actor.OrganizationID, id, false)
		if err != nil {
			return err
		}
		if !found {
			return identityaccess.ErrTraegerSchoolRoleNotFound
		}
		current = role
		return readstate.Check(expectedVersion, traegerRoleVersion(role))
	})
	return current, err
}

func traegerSchoolRoleOf(organizationID, id int64, input identityaccess.TraegerSchoolRoleInput) domain.TraegerSchoolRole {
	role := domain.TraegerSchoolRole{
		ID: id, OrganizationID: organizationID, Name: input.Name, Description: input.Description,
		BaseRole: input.BaseRole, PermissionIDs: input.PermissionIDs,
	}
	role.Normalize()
	return role
}

func invalidTraegerSchoolRole(role domain.TraegerSchoolRole) error {
	if field, reason := role.InvalidField(); field != "" {
		return &identityaccess.TraegerSchoolRoleInvalidError{Field: field, Reason: reason}
	}
	return nil
}

// requireStorable checks, in the Träger transaction, what the row
// constraints do not: the name of a platform role is taken, and every
// selected permission is one a school role may hold.
func (t *TraegerSchoolRoles) requireStorable(ctx context.Context, role domain.TraegerSchoolRole) error {
	taken, err := t.store.PlatformRoleNameExists(ctx, role.OrganizationID, role.Name)
	if err != nil {
		return err
	}
	if taken {
		return identityaccess.ErrTraegerSchoolRoleNameTaken
	}
	catalog, err := t.store.SchoolPermissionCatalog(ctx, role.OrganizationID)
	if err != nil {
		return err
	}
	known := make(map[int64]domain.ManagedPermission, len(catalog))
	for _, permission := range catalog {
		known[permission.ID] = permission
	}
	for _, id := range role.PermissionIDs {
		permission, found := known[id]
		if !found {
			return &identityaccess.TraegerSchoolRoleInvalidError{Field: "permission_ids", Reason: "unknown permission"}
		}
		if name := permissionKey(permission); identityaccess.IsReservedPermission(name) {
			return &identityaccess.ReservedPermissionError{Permission: name}
		}
	}
	return nil
}

// refuseNameOfSchoolRole reads every school before the Träger writes: a
// school that uses the name for a role of its own could not take the copy.
func (t *TraegerSchoolRoles) refuseNameOfSchoolRole(ctx context.Context, schools []identityaccess.TraegerSchoolRoleSchool, role domain.TraegerSchoolRole) error {
	states, err := t.schoolStates(ctx, schools)
	if err != nil {
		return err
	}
	var taken []string
	for _, school := range schools {
		if schoolCarry(role, school, states[school.ID]).NameTaken {
			taken = append(taken, school.Name)
		}
	}
	if len(taken) > 0 {
		return &identityaccess.TraegerSchoolRoleNameUsedError{Schools: taken}
	}
	return nil
}

// carry writes the role into every school of the Träger and returns it as
// the schools now carry it.
func (t *TraegerSchoolRoles) carry(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, role domain.TraegerSchoolRole, schools []identityaccess.TraegerSchoolRoleSchool) identityaccess.TraegerSchoolRole {
	states := make(map[int64][]domain.SchoolRoleState, len(schools))
	for _, school := range schools {
		// A school that fails keeps its previous state and shows as not
		// carried; the next change of the role tries it again.
		err := t.inSchool(ctx, school.ID, func(ctx context.Context) error {
			if err := t.carryInto(ctx, actor, school.ID, role); err != nil {
				return err
			}
			rows, err := t.store.SchoolRoleStates(ctx)
			states[school.ID] = rows
			return err
		})
		if err != nil {
			t.logger.WarnContext(ctx, "traeger school role not carried into school",
				"organization_id", actor.OrganizationID,
				"school_id", school.ID,
				"traeger_role_id", role.ID,
				"error", err.Error(),
			)
		}
	}
	return publicTraegerSchoolRole(role, schools, states)
}
