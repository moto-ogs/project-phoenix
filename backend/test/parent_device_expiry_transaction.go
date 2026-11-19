package test

import "maps"

const parentDeviceExpiryTransactionSite = "modules/delivery/internal/notifications/composition_provider.go:deleteExpiredParentDevice:tenant.WithinAdmin#1"
const parentDeviceExpiryTransactionReason = "ADR 0216: an expired parent device belongs to an account, not the sending school. Both push paths delete only the unchanged snapshot by device ID, account, portal, endpoint, keys and update timestamp. School delivery and its authorization still use the school unit."

// ADR 0216 gives both push paths one administrative command to retire
// the exact account device returned as expired by the provider.
func withoutReviewedParentDeviceExpiryTransaction(current map[string]string) map[string]string {
	if current[parentDeviceExpiryTransactionSite] != parentDeviceExpiryTransactionReason {
		return current
	}
	remaining := maps.Clone(current)
	delete(remaining, parentDeviceExpiryTransactionSite)
	return remaining
}
