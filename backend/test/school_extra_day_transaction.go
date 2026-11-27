package test

import "maps"

// schoolExtraDayTransactionSites are the boundaries ADR 0329 adds for the
// extra care days a school plans for itself (#4817): the school's unit that
// names its Träger, and the Träger transaction of that Träger the route
// opens afterwards. A further site needs its own decision.
var schoolExtraDayTransactionSites = map[string]string{
	"modules/enrollment/http/school_extra_days.go:*SchoolExtraDayResource.schoolTraeger:withinTenant#1": "ADR 0329: the school's extra day route reads the Träger of the session's school in the school's own tenant unit before any Träger context exists; the school comes from the session, the unit reads platform.schools only and ends before the Träger transaction opens.",
	"modules/enrollment/http/school_extra_days.go:withinSchoolTraeger:tenant.WithinTraeger#1":           "ADR 0329: the school's extra day route opens the Träger transaction of the Träger of the session's school, with the school masked, after the school's unit ended; neither unit nests in the other and the Träger never comes from the request. Inside it Enrollment admits only the extra days the school created and hosts alone.",
}

// withoutReviewedSchoolExtraDayTransactions removes exactly the reviewed
// boundaries, with their reviewed reasons, before the shrink-only
// comparison. It is no general escape: any other new or reworded site stays.
func withoutReviewedSchoolExtraDayTransactions(current map[string]string) map[string]string {
	remaining := current
	for site, reason := range schoolExtraDayTransactionSites {
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
