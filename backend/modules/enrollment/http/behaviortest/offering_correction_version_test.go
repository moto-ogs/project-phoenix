package enrollmenthttp_test

import (
	"context"

	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
)

// childOfferingCorrections are the decisions a correction reads and saves
// through.
type childOfferingCorrections interface {
	ListChildOfferings(context.Context, int64) (map[int64]enrollmentAPI.ChildOfferingSet, error)
	UpdateChildOfferings(context.Context, enrollmentAPI.UpdateChildOfferingsInput) (*enrollmentAPI.ChildOfferingsUpdate, error)
}

// correctOverRead is the office's correction as the editor sends it: over
// the offerings_version a read of the request right before answers (ADR
// 0311); a failed read sends none, so the correction is refused.
func correctOverRead(decisions childOfferingCorrections) func(context.Context, enrollmentAPI.UpdateChildOfferingsInput) (*enrollmentAPI.ChildOfferingsUpdate, error) {
	return func(ctx context.Context, input enrollmentAPI.UpdateChildOfferingsInput) (*enrollmentAPI.ChildOfferingsUpdate, error) {
		if sets, err := decisions.ListChildOfferings(ctx, input.RequestID); err == nil {
			input.ExpectedVersion = sets[input.ChildID].Version
		}
		return decisions.UpdateChildOfferings(ctx, input)
	}
}
