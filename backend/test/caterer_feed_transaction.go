package test

import "maps"

// catererFeedTransactionSites is the boundary ADR 0290 adds for the bell of
// the caterer portal (#7147): one administrative unit lists, counts or marks
// the feed entries of the session's account across the schools its caterer
// currently supplies, each statement re-checking the running supply and an
// active account. A further site needs its own decision.
var catererFeedTransactionSites = map[string]string{
	"modules/delivery/internal/notifications/caterer_feed.go:*catererFeed.inAdminTx:tenant.WithAdminTx#1": "ADR 0290: the caterer-portal bell lists, counts or marks only the session account's own feed entries of the caterer types across the schools its caterer currently supplies in one administrative unit; every statement re-checks the running supply and an active account, and it writes only read_at.",
}

// withoutReviewedCatererFeedTransactions removes exactly the reviewed
// boundary, with its reviewed reason, before the shrink-only comparison. It
// is no general escape: any other new or reworded site stays.
func withoutReviewedCatererFeedTransactions(current map[string]string) map[string]string {
	remaining := current
	for site, reason := range catererFeedTransactionSites {
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
