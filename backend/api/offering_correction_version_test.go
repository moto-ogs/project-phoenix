package api

import (
	"context"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// readOfferingsVersion is the offerings_version the request detail answers
// for the child, as the correction editor sends it back (ADR 0311); a failed
// read sends none, so the correction is refused.
func readOfferingsVersion(ctx context.Context, decisions interface {
	ListChildOfferings(context.Context, int64) (map[int64]enrollmentOwner.ChildOfferingSet, error)
}, requestID, childID int64) string {
	sets, err := decisions.ListChildOfferings(ctx, requestID)
	if err != nil {
		return ""
	}
	return sets[childID].Version
}
