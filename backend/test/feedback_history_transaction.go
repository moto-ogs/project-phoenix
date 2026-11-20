package test

import "maps"

const feedbackHistoryTransactionSite = "modules/feedback/compose/new.go:NewFeedbackHistory:tenant.NewTransactionRunner().RunInTx#1"
const feedbackHistoryTransactionReason = "Runtime binding (ADR 0298): NewFeedbackHistory wires the unit-of-work port of the demo seed's batch of past ratings. Constructing the writer starts no transaction; the batch commits in one transaction of the school in context, which the dev tools or the demo-only operator route name, or joins a supplied unit."

// ADR 0298 (#2352) gives the demo seed's past ratings a writer of their own
// in Feedback's composition: one batch in one transaction of the school in
// context. Only that exact site and reason are admitted; any other new or
// reworded site stays rejected.
func withoutReviewedFeedbackHistoryTransaction(current map[string]string) map[string]string {
	if current[feedbackHistoryTransactionSite] != feedbackHistoryTransactionReason {
		return current
	}
	remaining := maps.Clone(current)
	delete(remaining, feedbackHistoryTransactionSite)
	return remaining
}
