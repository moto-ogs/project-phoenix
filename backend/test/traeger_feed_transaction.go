package test

import "maps"

// traegerFeedTransactionSites is the boundary ADR 0286 adds for the bell of
// the Träger-Portal (#7146): one administrative unit lists, counts or marks
// the feed entries of the session's account across the schools of the
// session's Träger, each statement re-checking the active Träger membership.
// A further site needs its own decision.
var traegerFeedTransactionSites = map[string]string{
	"modules/delivery/internal/notifications/traeger_feed.go:*traegerFeed.inAdminTx:tenant.WithAdminTx#1": "ADR 0286: the Träger-Portal bell lists, counts or marks only the session account's own feed entries of the Träger types across the schools of the session's Träger in one administrative unit; every statement re-checks active Träger membership and an active account, and it writes only read_at.",
}

// withoutReviewedTraegerFeedTransactions removes exactly the reviewed
// boundary, with its reviewed reason, before the shrink-only comparison. It
// is no general escape: any other new or reworded site stays.
func withoutReviewedTraegerFeedTransactions(current map[string]string) map[string]string {
	remaining := current
	for site, reason := range traegerFeedTransactionSites {
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
