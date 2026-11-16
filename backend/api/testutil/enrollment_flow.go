package testutil

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/careplantest"
	"github.com/uptrace/bun"
)

var (
	// NewTestOfferingBookings composes Care Plan's effective-booking owner.
	NewTestOfferingBookings = careplantest.NewOfferingBookings
	// NewStoredPickupBaselines reads pickup baselines with booking
	// authority off.
	NewStoredPickupBaselines = careplantest.NewStoredPickupBaselines
)

// NewTestCarePlan composes Care Plan's capability over the test database;
// the enrollment suites built over it stamp on the real clock.
func NewTestCarePlan(tb careplantest.TB, db *bun.DB, directory careplantest.StudentDirectory) careplan.Capability {
	return careplantest.NewCarePlan(tb, db, directory, time.Now)
}
