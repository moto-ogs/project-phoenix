package testutil

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan/careplantest"
)

var (
	// NewTestCarePlan composes Care Plan's capability over the test
	// database.
	NewTestCarePlan = careplantest.NewCarePlan
	// NewTestOfferingBookings composes Care Plan's effective-booking owner,
	// stamping its booking rows with the real clock.
	NewTestOfferingBookings = withRealClock(careplantest.NewOfferingBookings)
	// NewStoredPickupBaselines reads pickup baselines with booking
	// authority off.
	NewStoredPickupBaselines = careplantest.NewStoredPickupBaselines
)

// withRealClock binds compose to the real clock.
func withRealClock[T any](compose func(func() time.Time) T) func() T {
	return func() T { return compose(time.Now) }
}
