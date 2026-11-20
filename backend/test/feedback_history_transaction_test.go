package test

import "testing"

func TestFeedbackHistoryTransactionExceptionIsExact(t *testing.T) {
	t.Parallel()
	current := map[string]string{feedbackHistoryTransactionSite: feedbackHistoryTransactionReason, "unrelated": "unchanged"}
	remaining := withoutReviewedFeedbackHistoryTransaction(current)
	if len(remaining) != 1 || remaining["unrelated"] != "unchanged" || len(current) != 2 {
		t.Fatal("reviewed boundary changed another register entry")
	}
	current[feedbackHistoryTransactionSite] = "different reason"
	if len(withoutReviewedFeedbackHistoryTransaction(current)) != 2 {
		t.Fatal("changed boundary reason was admitted")
	}
}
