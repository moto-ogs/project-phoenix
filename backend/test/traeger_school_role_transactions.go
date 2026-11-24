package test

import "maps"

// traegerSchoolRoleTransactionSites is the boundary ADR 0317 decides for the
// roles a Träger gives the staff of all its schools (#4810): Identity &
// Access reads and writes the Träger's role in the Träger transaction of the
// session's Träger and each school's copy in that school's own tenant
// transaction, never both at once (ADR 0105). A further site needs its own
// decision.
var traegerSchoolRoleTransactionSites = map[string]string{
	"modules/identityaccess/internal/application/traeger_school_roles.go:*TraegerSchoolRoles.inTraeger:t.ports.Runtime.WithinTraeger#1": "ADR 0317: a read or write of the roles a Träger gives its schools runs in the Träger transaction of the session's Träger; a write locks the role and commits it with its selection, and the schools' copies are read or brought up to date only in their own tenant transactions before or after it, never both at once (ADR 0105).",
}

// withoutReviewedTraegerSchoolRoleTransactions removes exactly the reviewed
// boundary, with its reviewed reason, before the shrink-only comparison. It
// is no general escape: any other new or reworded site stays.
func withoutReviewedTraegerSchoolRoleTransactions(current map[string]string) map[string]string {
	remaining := current
	for site, reason := range traegerSchoolRoleTransactionSites {
		if current[site] != reason {
			continue
		}
		if len(remaining) == len(current) {
			remaining = maps.Clone(current)
		}
		delete(remaining, site)
	}
	return remaining
}
