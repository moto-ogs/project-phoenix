package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewTraegerRooms composes the rooms of the Träger's utilization over time
// (#4713, ADR 0241) on the caller's administrative transaction.
func NewTraegerRooms() facilities.TraegerRooms {
	return postgres.NewTraegerRooms(tenant.TransactionFromContext, tenant.IsAdminTx)
}
