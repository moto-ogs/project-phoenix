package enrollment

import "context"

// A person of the Träger-Büro reviews registrations in a school they opened
// through the Absprung (ADR 0084 section 5, #7818). They hold the school's
// admin role and have no staff record there, so an approval cannot name them
// as the author of the weekly pickup and arrival rows it writes. Those rows
// carry Care Plan's mark of the Träger-Büro instead (#7766).
//
// The session decides who reviews, not the single call: the HTTP edge marks
// the request once, and an approval without a staff record of the reviewer
// writes its weekly rows as the Träger-Büro only when the mark is set.

type traegerBueroReviewerKey struct{}

// WithTraegerBueroReviewer marks ctx as the request of a person of the
// Träger-Büro who may have no staff record at the school.
func WithTraegerBueroReviewer(ctx context.Context) context.Context {
	return context.WithValue(ctx, traegerBueroReviewerKey{}, true)
}

// TraegerBueroReviewer reports whether ctx carries the mark of the
// Träger-Büro. A reviewer with a staff record of the school still writes as
// that staff member.
func TraegerBueroReviewer(ctx context.Context) bool {
	marked, _ := ctx.Value(traegerBueroReviewerKey{}).(bool)
	return marked
}
