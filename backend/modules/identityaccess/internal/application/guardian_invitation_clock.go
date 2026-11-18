package application

import (
	"context"
	"time"
)

// Every instant of auth.guardian_invitations lives on the database clock
// (ADR 0285, Nachtrag): auth.account_is_unused keeps an account for an open
// guardian invitation judged against statement_timestamp(), so the
// invitation is stamped and judged on that clock, once per operation.

// invitationTime reads the database time in the transaction of ctx.
func (l *AccountLifecycle) invitationTime(ctx context.Context) (time.Time, error) {
	now, _, err := l.invitations.DatabaseTime(ctx)
	return now, err
}

// invitationExpiry is the expiry of a link issued now: the tenant's
// lifetime counted from the database time.
func (l *AccountLifecycle) invitationExpiry(ctx context.Context) (time.Time, error) {
	lifetime, err := l.delivery.InvitationExpiry(ctx)
	if err != nil {
		return time.Time{}, err
	}
	now, err := l.invitationTime(ctx)
	if err != nil {
		return time.Time{}, err
	}
	return now.Add(lifetime), nil
}
