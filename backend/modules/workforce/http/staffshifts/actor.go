package staffshifts

import (
	"errors"
	"net/http"
)

// Actor is the acting admin behind a write: the staff record a plan change
// is attributed to and the account an audit entry names. Traeger marks a
// person of the Träger-Büro in a school session opened through the
// Träger-Portal, who has no staff record at the school (#7818, ADR 0084
// section 5): rows it creates carry the mark of the Träger-Büro instead of a
// staff author.
type Actor struct {
	StaffID   int64
	AccountID *int64
	Traeger   bool
}

// ErrNoStaffActor refuses a caller without a staff record of the school who
// did not come through the Träger-Portal: every plan change needs an author.
var ErrNoStaffActor = errors.New("staff record not found")

// NewActor is the acting admin behind staffID; a caller without a staff
// record (staffID <= 0) is ErrNoStaffActor.
func NewActor(staffID int64, accountID *int64) (Actor, error) {
	if staffID <= 0 {
		return Actor{}, ErrNoStaffActor
	}
	return Actor{StaffID: staffID, AccountID: accountID}, nil
}

// NewTraegerActor is the Träger-Büro acting through accountID in a school
// session without a staff record. A session without an account cannot
// happen for an authenticated request, so it is a server failure.
func NewTraegerActor(accountID *int64) (Actor, error) {
	if accountID == nil || *accountID <= 0 {
		return Actor{}, errors.New("träger session without an account")
	}
	return Actor{AccountID: accountID, Traeger: true}, nil
}

// traegerAccountID is the account a write of the Träger-Büro is planned by;
// 0 for a staff member.
func (a Actor) traegerAccountID() int64 {
	if !a.Traeger || a.AccountID == nil {
		return 0
	}
	return *a.AccountID
}

// actor resolves the acting admin or renders the failure: a caller without
// a staff record is refused (403), a failed lookup is the server's (500).
func (rs *Resource) actor(w http.ResponseWriter, r *http.Request) (Actor, bool) {
	actor, err := rs.runtime.ResolveActor(r.Context())
	if err != nil {
		kind := FailureInternal
		if errors.Is(err, ErrNoStaffActor) {
			kind = FailureForbidden
		}
		rs.runtime.Failure(w, r, kind, err)
		return Actor{}, false
	}
	return actor, true
}
