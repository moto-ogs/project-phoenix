package test

import "testing"

func TestSchoolExtraDayTransactionExceptionIsExact(t *testing.T) {
	t.Parallel()
	current := map[string]string{"unrelated": "unchanged"}
	for site, reason := range schoolExtraDayTransactionSites {
		current[site] = reason
	}
	remaining := withoutReviewedSchoolExtraDayTransactions(current)
	if len(remaining) != 1 || remaining["unrelated"] != "unchanged" {
		t.Fatalf("reviewed school extra day boundaries were not removed exactly: %#v", remaining)
	}
	for site := range schoolExtraDayTransactionSites {
		current[site] = "different reason"
	}
	if len(withoutReviewedSchoolExtraDayTransactions(current)) != len(current) {
		t.Fatal("a reworded school extra day boundary escaped the shrink-only check")
	}
}
