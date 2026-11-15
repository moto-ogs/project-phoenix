package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewPresentStudents composes the current children of the Träger's school view
// (#5686, ADR 0151) on the caller's administrative transaction.
func NewPresentStudents() studentpresence.PresentStudents {
	return postgres.NewPresentStudents(tenant.TransactionFromContext, tenant.IsAdminTx)
}

// NewPresenceSeries composes the attendance and room days of the Träger's
// utilization over time (#4713, ADR 0241) on the caller's administrative
// transaction.
func NewPresenceSeries() studentpresence.PresenceSeries {
	return postgres.NewPresenceSeries(tenant.TransactionFromContext, tenant.IsAdminTx)
}
