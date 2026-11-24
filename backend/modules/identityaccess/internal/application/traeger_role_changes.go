package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ChangeTraegerRoles replaces the role set of an active member and mails the
// person (#5474). An added role reaches the person's session at its next
// refresh; a withdrawn role ends the person's Träger sessions at once, since
// the access token still carries its rights (#6850).
//
// The set is replaced only over the one the caller read (expectedVersion,
// ADR 0311): the member's account row is locked before the roles are read,
// the lock the invitation acceptance and the operator's grant take before
// they add a role, so the check and the replacement see the same set. The
// Leitung rows are locked first, as in every command of the Träger-Büro;
// the acceptance and the grant only insert roles, which never waits on
// them.
func (t *TraegerAccounts) ChangeTraegerRoles(ctx context.Context, actor identityaccess.TraegerActor, accountID int64, roles []string, expectedVersion string) (identityaccess.TraegerMember, error) {
	roles, err := normalizeTraegerRoles(roles)
	if err != nil {
		return identityaccess.TraegerMember{}, err
	}
	var result identityaccess.TraegerMember
	err = t.run(ctx, actor, func(txCtx context.Context, unit traegerUnit) error {
		membership, ok := unit.member(accountID)
		if !ok {
			return identityaccess.ErrTraegerMemberNotFound
		}
		before, err := t.lockedTraegerRoles(txCtx, actor.OrganizationID, accountID, expectedVersion)
		if err != nil {
			return err
		}
		if err := unit.checkLeadershipChange(accountID, before, roles); err != nil {
			return err
		}
		if err := t.replaceTraegerRoles(txCtx, actor.OrganizationID, accountID, before, roles); err != nil {
			return err
		}
		accounts, _, err := t.store.ListTraegerAccounts(txCtx, actor.OrganizationID, []int64{accountID})
		if err != nil {
			return err
		}
		if len(accounts) != 1 {
			return identityaccess.ErrTraegerMemberNotFound
		}
		result = publicTraegerMember(accounts[0], membership)
		return t.notifyAndRecord(txCtx, actor, unit, identityaccess.TraegerAccountRolesChanged, accounts[0], before, roles)
	})
	return result, err
}

// lockedTraegerRoles locks the member's account row, reads its roles at the
// Träger and refuses a set other than the one the caller read
// (readstate.ErrChanged). An erased account is no member any more.
func (t *TraegerAccounts) lockedTraegerRoles(ctx context.Context, organizationID, accountID int64, expectedVersion string) ([]string, error) {
	if _, found, _, err := t.store.FindLoginAccount(ctx, accountID, true); err != nil {
		return nil, err
	} else if !found {
		return nil, identityaccess.ErrTraegerMemberNotFound
	}
	roles, _, err := t.store.ListTraegerRoles(ctx, organizationID, accountID)
	if err != nil {
		return nil, err
	}
	if err := readstate.Check(expectedVersion, identityaccess.TraegerRolesVersion(roles)); err != nil {
		return nil, err
	}
	return roles, nil
}

// replaceTraegerRoles grants the member the roles after in place of before.
// A role of before that after lacks ends the member's Träger sessions, so
// its right leaves the issued access tokens at once (#6850).
func (t *TraegerAccounts) replaceTraegerRoles(ctx context.Context, organizationID, accountID int64, before, after []string) error {
	if _, err := t.store.ReplaceTraegerRoles(ctx, organizationID, accountID, after); err != nil {
		return err
	}
	if !identityaccess.TraegerRolesWithdrawn(before, after) {
		return nil
	}
	_, err := t.store.DeleteTraegerAccountSessions(ctx, organizationID, accountID)
	return err
}
