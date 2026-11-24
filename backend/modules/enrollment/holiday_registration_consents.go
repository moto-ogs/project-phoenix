package enrollment

import (
	"context"
	"time"
)

// The voluntary consents of a holiday registration (#8038, ADR 0321). The
// Träger asks them as legal blocks of the kind "consent" in its form; a
// consent never gates the registration (Art. 7 Abs. 4 DSGVO). The parents
// with a parent account see them in the parents portal and withdraw them
// there as easily as they gave them (Art. 7 Abs. 3 DSGVO), or give them
// again. The hosting school reads them live from the registration, for the
// participant list and the sheet of a holiday guest.

// HolidayAuditConsent is the entry of the registration's audit trail for a
// consent the parents withdrew or gave again.
const HolidayAuditConsent = "consent"

// HolidayRegistrationConsent is one voluntary consent of a registration, in
// the words of the form version the registration came with. Given says
// whether the parents give it right now. ChangedAt is when they gave it
// while it is given, when they withdrew it while it is not, and nil for a
// consent they never gave. Text is the explanation of the block; the
// hosting school does not get it.
type HolidayRegistrationConsent struct {
	Key       string     `json:"key"`
	Title     string     `json:"title"`
	Label     string     `json:"label"`
	Text      string     `json:"text,omitempty"`
	Given     bool       `json:"given"`
	ChangedAt *time.Time `json:"changed_at"`
}

// HolidayConsentWithdrawals lets the Träger-Büro record a withdrawal the
// parents declared outside moto, by mail, letter or phone (ADR 0321,
// point 3a): parents without a parent account withdraw this way, and the
// hosting school reads it at once like one from the parents portal. The
// office only withdraws; giving a consent stays with the parents.
type HolidayConsentWithdrawals interface {
	// WithdrawHolidayConsent withdraws the given consent key of the
	// registration in the reviewer's Träger transaction and records it in
	// the registration's audit trail with the reviewer as its author. A
	// consent that is not given, or that the registration's form version
	// does not ask, refuses with ErrHolidayRegistrationStateConflict.
	WithdrawHolidayConsent(ctx context.Context, reviewer HolidayReviewer, periodID, registrationID int64, key string) (HolidayRegistrationDetail, error)
}
