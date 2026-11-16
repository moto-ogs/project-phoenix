package test

import "maps"

// guardianFeedTransactionSites is the boundary ADR 0249 adds for the bell of
// the parents portal (#7140): one administrative unit lists, counts or marks
// the feed entries of the session's guardian account across its schools,
// each statement re-checking membership and parent_portal.access. A further
// site needs its own decision.
var guardianFeedTransactionSites = map[string]string{
	"modules/delivery/internal/notifications/guardian_feed.go:*guardianFeed.inAdminTx:tenant.WithAdminTx#1": "ADR 0249: the parents portal bell lists, counts or marks only the session account's own feed entries across its schools in one administrative unit; every statement re-checks active guardian membership and parent_portal.access for the entry's children in the entry's school, and it writes only read_at.",
}

// withoutReviewedGuardianFeedTransactions removes exactly the reviewed
// boundary, with its reviewed reason, before the shrink-only comparison. It
// is no general escape: any other new or reworded site stays.
func withoutReviewedGuardianFeedTransactions(current map[string]string) map[string]string {
	remaining := current
	for site, reason := range guardianFeedTransactionSites {
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
