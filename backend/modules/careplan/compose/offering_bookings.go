package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/adapters/postgres"
	applicationBindings "github.com/moto-ogs/project-phoenix/modules/careplan/internal/application"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewOfferingBookings binds the owner to the ambient UnitOfWork, never to an unscoped
// pool, so it joins atomic Enrollment workflows; now stamps the rows it writes.
func NewOfferingBookings(now func() time.Time) *careplan.OfferingBookings {
	return newOfferingBookings(applicationBindings.ObserveOfferingBookings(), now)
}

func newOfferingBookings(observe func(careplan.OfferingBookingObservation), now func() time.Time) *careplan.OfferingBookings {
	store := postgres.New(postgres.NewOfferingBookingsDatabase()).WithClock(now)
	return careplan.NewOfferingBookings(store, tenant.NewTransactionRunner(), observe)
}
