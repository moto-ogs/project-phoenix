package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewTraegerCareBookings composes the booked care offerings of the Träger's
// occupancy (#4676, ADR 0154) on the caller's administrative transaction.
func NewTraegerCareBookings() careplan.TraegerCareBookings {
	return postgres.NewTraegerCareBookings(tenant.TransactionFromContext, tenant.IsAdminTx)
}

// NewTraegerCareBookingIntervals composes the bookings of the Träger's
// utilization over time (#4713, ADR 0241) on the caller's administrative
// transaction.
func NewTraegerCareBookingIntervals() careplan.TraegerCareBookingIntervals {
	return postgres.NewTraegerCareBookingIntervals(tenant.TransactionFromContext, tenant.IsAdminTx)
}
