package identityaccess

import "context"

// TraegerAccountEmails reads, in the caller's Träger transaction of
// organizationID, the current addresses of the supplied parents accounts:
// the Betreuungsvertrag names where a party's invoices go (#8215). The
// caller supplies only accounts its own Träger rows hold. Inactive and
// erased accounts are absent.
type TraegerAccountEmails interface {
	TraegerAccountEmails(ctx context.Context, organizationID int64, accountIDs []int64) (map[int64]string, error)
}
