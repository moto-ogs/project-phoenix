package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
)

// staffLookup is the caller's staff profile, as every request decision port
// reads it.
type staffLookup interface {
	CurrentStaffID(context.Context) (staffID int64, found bool, err error)
}

// actingStaffID is the staff member a decision writes plans in the name of.
// Only staff decide parent requests: a caller without a staff profile is
// refused, whatever its permissions say. The one exception is a person of the
// Träger-Büro in a school they opened through the Absprung (#7766): they have
// no staff record there by design, the result is 0, and the rows they write
// carry the mark of the Träger-Büro instead.
func actingStaffID(ctx context.Context, staff staffLookup, purpose string) (int64, error) {
	staffID, found, err := staff.CurrentStaffID(ctx)
	if err != nil {
		return 0, fmt.Errorf("schedule: resolve acting staff%s: %w", purpose, err)
	}
	if found {
		return staffID, nil
	}
	if careplan.EnteredByTraeger(ctx, 0) {
		return 0, nil
	}
	return 0, carerequests.ErrCareRequestStaffProfileRequired
}

// pickupRequestStaff is the purpose suffix of a pickup request decision.
const pickupRequestStaff = " for pickup request"

// optionalStaff is a staff author as an optional reference: nil when the
// Träger-Büro writes and no staff member is named.
func optionalStaff(staffID int64) *int64 {
	if staffID <= 0 {
		return nil
	}
	return &staffID
}
