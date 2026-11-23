package careplan

import "context"

// A person of the Träger-Büro enters Betreuungszeiten in a school they opened
// through the Absprung (ADR 0084 section 5, #7766). They hold the school's
// admin role and have no staff record there, so nothing can name them in
// created_by. Their rows carry the mark EnteredByTraeger instead, as the
// shifts the Personalverwaltung plans carry planned_by_traeger (#4708).
//
// The session decides who writes, not the single call: the HTTP edge marks
// the request once, and every row the request writes without a staff author
// takes the mark from there.

type traegerBueroAuthorKey struct{}

// WithTraegerBueroAuthor marks ctx as the request of a person of the
// Träger-Büro who has no staff record at the school.
func WithTraegerBueroAuthor(ctx context.Context) context.Context {
	return context.WithValue(ctx, traegerBueroAuthorKey{}, true)
}

// EnteredByTraeger reports whether a row written in ctx with the staff author
// staffID carries the mark of the Träger-Büro. A staff member of the school
// is always named in the row itself.
func EnteredByTraeger(ctx context.Context, staffID int64) bool {
	if staffID > 0 {
		return false
	}
	marked, _ := ctx.Value(traegerBueroAuthorKey{}).(bool)
	return marked
}

// HasScheduleAuthor reports whether a write in ctx names its author: a staff
// member of the school, or the Träger-Büro.
func HasScheduleAuthor(ctx context.Context, staffID int64) bool {
	return staffID > 0 || EnteredByTraeger(ctx, staffID)
}
