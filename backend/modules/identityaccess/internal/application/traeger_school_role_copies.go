package application

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The copy of a Träger role at one school (#4810, ADR 0317). Every function
// here runs in that school's tenant transaction. Locks follow the role
// administration: the holders' accounts in ID order, then the role row.

const (
	traegerRoleActionCreated = "created"
	traegerRoleActionUpdated = "updated"
	traegerRoleActionRemoved = "removed"
	// traegerRoleActionReleased: the Träger removed its role, the school
	// keeps the copy as a role of its own.
	traegerRoleActionReleased = "released"
)

// errTraegerRoleNameTakenAtSchool keeps a school whose own role has the name
// at its previous state; the list shows the reason.
var errTraegerRoleNameTakenAtSchool = errors.New("the school uses the name for a role of its own")

// carryInto writes the role into the school of the tenant transaction: into
// the copy that names it, else into a new copy.
func (t *TraegerSchoolRoles) carryInto(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, schoolID int64, role domain.TraegerSchoolRole) error {
	states, err := t.store.SchoolRoleStates(ctx)
	if err != nil {
		return err
	}
	copyID := int64(0)
	for _, state := range states {
		switch {
		case state.TraegerRoleID != nil && *state.TraegerRoleID == role.ID:
			copyID = state.RoleID
		case state.TraegerRoleID == nil && state.Name == role.CopyName():
			return errTraegerRoleNameTakenAtSchool
		}
	}
	if copyID == 0 {
		return t.createCopy(ctx, actor, schoolID, role)
	}
	return t.updateCopy(ctx, actor, schoolID, copyID, role)
}

func (t *TraegerSchoolRoles) createCopy(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, schoolID int64, role domain.TraegerSchoolRole) error {
	baseRole, traegerRoleID := role.BaseRole, role.ID
	created, err := t.roles.store.CreateRole(ctx, domain.ManagedRole{
		Name: role.CopyName(), Description: role.Description, BaseRole: &baseRole, TraegerRoleID: &traegerRoleID,
	})
	if err != nil {
		return err
	}
	if err := t.roles.store.AssignRolePermissions(ctx, created.ID, role.PermissionIDs); err != nil {
		return err
	}
	return t.recordCopyChange(ctx, actor, schoolID, created, traegerRoleActionCreated, 0)
}

// updateCopy rewrites the copy's master data and selection. A dropped
// permission ends the sessions of everyone who holds the role, as a school's
// own permission change does; an added one arrives at the next renewal.
func (t *TraegerSchoolRoles) updateCopy(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, schoolID, copyID int64, role domain.TraegerSchoolRole) error {
	existing, err := t.lockCopy(ctx, copyID)
	if err != nil {
		return err
	}
	changed := existing.Name != role.CopyName() || existing.Description != role.Description ||
		existing.BaseRole == nil || *existing.BaseRole != role.BaseRole
	if changed {
		baseRole := role.BaseRole
		existing.Name, existing.Description, existing.BaseRole = role.CopyName(), role.Description, &baseRole
		if existing, err = t.roles.store.UpdateRole(ctx, existing); err != nil {
			return err
		}
	}
	selectionChanged, err := t.replaceCopySelection(ctx, copyID, role.PermissionIDs)
	if err != nil {
		return err
	}
	if !changed && !selectionChanged {
		return nil
	}
	return t.recordCopyChange(ctx, actor, schoolID, existing, traegerRoleActionUpdated, 0)
}

// lockCopy locks the holders and then the row of a copy, and refuses a
// holder set that changed in between.
func (t *TraegerSchoolRoles) lockCopy(ctx context.Context, copyID int64) (domain.ManagedRole, error) {
	holders, err := t.roles.lockRoleHolders(ctx, copyID)
	if err != nil {
		return domain.ManagedRole{}, err
	}
	existing, found, err := t.roles.store.FindRoleForUpdate(ctx, copyID)
	if err != nil {
		return domain.ManagedRole{}, err
	}
	if !found || existing.TraegerRoleID == nil {
		return domain.ManagedRole{}, domain.ErrRoleNotFound
	}
	return existing, t.roles.requireLockedRoleHolders(ctx, copyID, holders)
}

// replaceCopySelection makes desired the copy's selection and reports
// whether anything changed.
func (t *TraegerSchoolRoles) replaceCopySelection(ctx context.Context, copyID int64, desired []int64) (bool, error) {
	current, err := t.roles.store.ListRolePermissions(ctx, copyID)
	if err != nil {
		return false, err
	}
	held := make([]int64, 0, len(current))
	removed := false
	for _, permission := range current {
		held = append(held, permission.ID)
		if slices.Contains(desired, permission.ID) {
			continue
		}
		removed = true
		if err := t.roles.store.RemoveRolePermission(ctx, copyID, permission.ID); err != nil {
			return false, err
		}
	}
	added := make([]int64, 0, len(desired))
	for _, id := range desired {
		if !slices.Contains(held, id) {
			added = append(added, id)
		}
	}
	if err := t.roles.store.AssignRolePermissions(ctx, copyID, added); err != nil {
		return false, err
	}
	if removed {
		if err := t.roles.revokeRoleHolderSessions(ctx, copyID); err != nil {
			return false, err
		}
	}
	return removed || len(added) > 0, nil
}

// recordCopyChange files the change in the school's ledger with the level
// „Träger“: who of the Träger-Büro changed which role of the school.
func (t *TraegerSchoolRoles) recordCopyChange(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, schoolID int64, role domain.ManagedRole, action string, holdersRemoved int) error {
	evidence := &domain.TraegerRoleEvidence{Action: action, RoleID: role.ID, RoleName: role.Name, HoldersRemoved: holdersRemoved}
	if role.TraegerRoleID != nil {
		evidence.TraegerRoleID = *role.TraegerRoleID
	}
	ipAddress := actor.IPAddress
	if ipAddress == "" {
		ipAddress = domain.InternalRevocationAuditIP
	}
	return t.audit.RecordAuthEvent(ctx, domain.AuthEvent{
		AccountID: actor.AccountID, TenantID: schoolID, Type: domain.AuthEventTraegerRoleChanged, Success: true,
		IPAddress: ipAddress, UserAgent: actor.UserAgent, OrganizationID: actor.OrganizationID, TraegerRole: evidence,
	})
}

// PreviewTraegerSchoolRoleRemoval reads who holds the role at which school.
func (t *TraegerSchoolRoles) PreviewTraegerSchoolRoleRemoval(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, id int64) (identityaccess.TraegerSchoolRoleRemoval, error) {
	role, schools, err := t.roleAndSchools(ctx, actor, id)
	if err != nil {
		return identityaccess.TraegerSchoolRoleRemoval{}, err
	}
	removal := identityaccess.TraegerSchoolRoleRemoval{RoleID: role.ID, Name: role.Name, Schools: make([]identityaccess.TraegerSchoolRoleRemovalSchool, 0, len(schools))}
	for _, school := range schools {
		entry := identityaccess.TraegerSchoolRoleRemovalSchool{SchoolID: school.ID, SchoolName: school.Name}
		err := t.inSchool(ctx, school.ID, func(ctx context.Context) error {
			var err error
			entry.Holders, entry.KeptForInvitations, err = t.copyHolders(ctx, role.ID)
			return err
		})
		if err != nil {
			return identityaccess.TraegerSchoolRoleRemoval{}, err
		}
		removal.Schools = append(removal.Schools, entry)
	}
	removal.Version = removalVersion(removal)
	return removal, nil
}

func (t *TraegerSchoolRoles) roleAndSchools(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, id int64) (domain.TraegerSchoolRole, []identityaccess.TraegerSchoolRoleSchool, error) {
	var role domain.TraegerSchoolRole
	err := t.inTraeger(ctx, actor, func(ctx context.Context) error {
		found := false
		var err error
		role, found, err = t.store.FindTraegerSchoolRole(ctx, actor.OrganizationID, id, false)
		if err == nil && !found {
			err = identityaccess.ErrTraegerSchoolRoleNotFound
		}
		return err
	})
	if err != nil {
		return domain.TraegerSchoolRole{}, nil, err
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	return role, schools, err
}

// copyHolders lists who holds the copy of the Träger role at the school of
// the tenant transaction, by name, and whether an invitation keeps the copy.
func (t *TraegerSchoolRoles) copyHolders(ctx context.Context, traegerRoleID int64) ([]identityaccess.TraegerSchoolRoleHolder, bool, error) {
	copyID, err := t.copyOf(ctx, traegerRoleID)
	if err != nil || copyID == 0 {
		return []identityaccess.TraegerSchoolRoleHolder{}, false, err
	}
	ids, err := t.roles.store.ListRoleHolderAccountIDs(ctx, copyID)
	if err != nil {
		return nil, false, err
	}
	emails, err := t.roles.store.ListAccountEmails(ctx, ids)
	if err != nil {
		return nil, false, err
	}
	names, err := t.ports.People.AccountNames(ctx, ids)
	if err != nil {
		return nil, false, err
	}
	invitations, err := t.store.CountRoleInvitations(ctx, copyID)
	if err != nil {
		return nil, false, err
	}
	holders := make([]identityaccess.TraegerSchoolRoleHolder, 0, len(ids))
	for _, id := range ids {
		holders = append(holders, identityaccess.TraegerSchoolRoleHolder{AccountID: id, Name: names[id], Email: emails[id]})
	}
	slices.SortFunc(holders, func(a, b identityaccess.TraegerSchoolRoleHolder) int {
		if order := strings.Compare(strings.ToLower(holderLabel(a)), strings.ToLower(holderLabel(b))); order != 0 {
			return order
		}
		return int(a.AccountID - b.AccountID)
	})
	return holders, invitations > 0, nil
}

func holderLabel(holder identityaccess.TraegerSchoolRoleHolder) string {
	if holder.Name != "" {
		return holder.Name
	}
	return holder.Email
}

// copyOf finds the school's copy of the Träger role; zero without one.
func (t *TraegerSchoolRoles) copyOf(ctx context.Context, traegerRoleID int64) (int64, error) {
	states, err := t.store.SchoolRoleStates(ctx)
	if err != nil {
		return 0, err
	}
	for _, state := range states {
		if state.TraegerRoleID != nil && *state.TraegerRoleID == traegerRoleID {
			return state.RoleID, nil
		}
	}
	return 0, nil
}

// removalVersion is the token of a preview: the role and, per school, the
// accounts that hold it, in ascending order.
func removalVersion(removal identityaccess.TraegerSchoolRoleRemoval) string {
	type school struct {
		ID      int64   `json:"id"`
		Holders []int64 `json:"holders"`
		Kept    bool    `json:"kept"`
	}
	state := struct {
		RoleID  int64    `json:"role_id"`
		Schools []school `json:"schools"`
	}{RoleID: removal.RoleID, Schools: make([]school, 0, len(removal.Schools))}
	for _, entry := range removal.Schools {
		ids := make([]int64, 0, len(entry.Holders))
		for _, holder := range entry.Holders {
			ids = append(ids, holder.AccountID)
		}
		slices.Sort(ids)
		state.Schools = append(state.Schools, school{ID: entry.SchoolID, Holders: ids, Kept: entry.KeptForInvitations})
	}
	slices.SortFunc(state.Schools, func(a, b school) int { return int(a.ID - b.ID) })
	return readstate.Fingerprint(state)
}

// RemoveTraegerSchoolRole removes the role from every school and then from
// the Träger. The preview is read again first: a holder set that differs
// from the confirmed one removes nothing (ADR 0311). Each school checks its
// own holders once more under its locks.
func (t *TraegerSchoolRoles) RemoveTraegerSchoolRole(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, id int64, expectedVersion string) error {
	removal, err := t.PreviewTraegerSchoolRoleRemoval(ctx, actor, id)
	if err != nil {
		return err
	}
	if err := readstate.Check(expectedVersion, removal.Version); err != nil {
		return err
	}
	for _, school := range removal.Schools {
		if err := t.removeFromSchool(ctx, actor, id, school); err != nil {
			return err
		}
	}
	return t.inTraeger(ctx, actor, func(ctx context.Context) error {
		return t.store.DeleteTraegerSchoolRole(ctx, actor.OrganizationID, id)
	})
}

// removeFromSchool deletes the school's copy with its assignments. An
// invitation that names the copy blocks the deletion (auth.invitation_tokens):
// the copy then stays as a role of the school's own with its holders, so the
// invitation keeps working and the school decides.
func (t *TraegerSchoolRoles) removeFromSchool(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, traegerRoleID int64, school identityaccess.TraegerSchoolRoleRemovalSchool) error {
	return t.inSchool(ctx, school.SchoolID, func(ctx context.Context) error {
		return t.deleteCopy(ctx, actor, traegerRoleID, school)
	})
}

func (t *TraegerSchoolRoles) deleteCopy(ctx context.Context, actor identityaccess.TraegerSchoolRoleActor, traegerRoleID int64, school identityaccess.TraegerSchoolRoleRemovalSchool) error {
	copyID, err := t.copyOf(ctx, traegerRoleID)
	if err != nil || copyID == 0 {
		return err
	}
	existing, err := t.lockCopy(ctx, copyID)
	if err != nil {
		return err
	}
	holders, err := t.roles.store.ListRoleHolderAccountIDs(ctx, copyID)
	if err != nil {
		return err
	}
	confirmed := make([]int64, 0, len(school.Holders))
	for _, holder := range school.Holders {
		confirmed = append(confirmed, holder.AccountID)
	}
	slices.Sort(confirmed)
	invitations, err := t.store.CountRoleInvitations(ctx, copyID)
	if err != nil {
		return err
	}
	if !slices.Equal(holders, confirmed) || (invitations > 0) != school.KeptForInvitations {
		return readstate.ErrChanged
	}
	if invitations > 0 {
		if err := t.store.ReleaseTraegerRoleCopy(ctx, copyID); err != nil {
			return err
		}
		return t.recordCopyChange(ctx, actor, school.SchoolID, existing, traegerRoleActionReleased, 0)
	}
	if err := t.roles.revokeRoleHolderSessions(ctx, copyID); err != nil {
		return err
	}
	if err := t.roles.store.DeleteRoleAssignments(ctx, copyID); err != nil {
		return err
	}
	if err := t.roles.store.DeleteRolePermissions(ctx, copyID); err != nil {
		return err
	}
	if err := t.roles.store.DeleteRole(ctx, copyID); err != nil {
		return err
	}
	return t.recordCopyChange(ctx, actor, school.SchoolID, existing, traegerRoleActionRemoved, len(holders))
}
