package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

// CatererInvitationDelivery mails a school's invitation to its caterer (ADR
// 0074) through the outbox, in the school's transaction. The link exists
// only in the mail; a failed enqueue fails the invitation.
type CatererInvitationDelivery interface {
	// EnqueueCatererInvitation states the days until expiresAt, an instant
	// on the composition's clock: the invitation's database expiry moved by
	// that clock's distance to the database (ADR 0285).
	EnqueueCatererInvitation(ctx context.Context, invitationID, schoolID int64, email, catererName, token string, expiresAt time.Time) error
	// CatererInvitationMailStates reports, in one read, what became of the
	// mail of each invitation (#5960); an invitation without a mail has no key.
	CatererInvitationMailStates(ctx context.Context, tenantID int64, invitationIDs []int64) (map[int64]identityaccess.InvitationMailState, error)
	// CancelCatererInvitation stops the mail of a revoked invitation that
	// is not sent yet, in the school's transaction (#4496); a mail already
	// handed to the provider stays sent.
	CancelCatererInvitation(ctx context.Context, invitationID int64) error
}
