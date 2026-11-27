package identityaccess

import (
	"context"
	"errors"
	"time"
)

// ErrAccountAdministrationUnavailable reports a composition without the
// account lifecycle dependencies the administration flows need.
var ErrAccountAdministrationUnavailable = errors.New("account administration is not composed")

// ErrAccountSharedAcrossSchools refuses a school administrator's change to
// what holds for the whole account, its second factor, while the account
// also belongs to another school or to a Träger (#6862). Such an account's
// identity is not one school's to rewrite; the operator changes it.
var ErrAccountSharedAcrossSchools = errors.New("account also belongs to another school or a Träger")

// ManagedAccount is one platform account as the administration reports it.
// The credential never leaves the owner.
type ManagedAccount struct {
	ID        int64
	Email     string
	Username  string
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
	LastLogin *time.Time
}

// OwnPasswordChange is an account holder's change of their own password.
// SessionFamilyID names the refresh-token family of the session the change
// is made in: it stays signed in, while every other session of the account,
// its open reset links and its remembered devices end with the change
// (#6289). IPAddress and UserAgent go into the revocation's audit evidence.
type OwnPasswordChange struct {
	AccountID       int64
	SessionFamilyID string
	CurrentPassword string
	NewPassword     string
	IPAddress       string
	UserAgent       string
}

// AccountAdministration administers platform accounts (#3332): the read of
// one manageable account, deactivation, and the credential
// change an account holder makes for themselves.
//
// Accounts are platform-wide rows without a tenant, so ordinary administration
// commands are restricted to the account set the caller may administer:
// the school in context, the manageable schools of their organisation, or every account
// for a platform-scoped caller and an administrative transaction. An
// account outside that set reads as ErrAccountNotFound, so the boundary
// never reveals that it exists. ChangeAccountPassword
// is the account holder's own business and carries no such predicate; who
// may ask for it is the request boundary's decision. AnonymizeAccountForDeletion
// is likewise account-wide and reserved for the authorized platform deletion flow.
//
// Refusals arrive wrapped in an AuthenticationError whose Op names the
// flow, carrying ErrAccountNotFound, ErrInvalidCredentials or
// ErrPasswordTooWeak.
type AccountAdministration interface {
	// AnonymizeAccountForDeletion replaces identifying fields for an already
	// authorized platform deletion workflow. It is account-wide, preserves
	// the caller's transaction, and does not deactivate or unlink the account.
	AnonymizeAccountForDeletion(ctx context.Context, accountID int64, email string) error
	FindManageableAccount(ctx context.Context, accountID int64) (ManagedAccount, error)
	DeactivateAccount(ctx context.Context, accountID int64) error
	ChangeAccountPassword(ctx context.Context, change OwnPasswordChange) error
}
