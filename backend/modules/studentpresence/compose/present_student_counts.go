package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewPresentStudents composes the Träger's reads of Student Presence, the
// current children (#5686, ADR 0151) and the arrival and pickup times (#4714).
func NewPresentStudents() studentpresence.TraegerPresence {
	return postgres.NewPresentStudents(tenant.TransactionFromContext, tenant.IsAdminTx)
}

// NewPresenceSeries composes the attendance and room days of the Träger's
// utilization over time (#4713, ADR 0241) on the caller's administrative
// transaction.
func NewPresenceSeries() studentpresence.PresenceSeries {
	return postgres.NewPresenceSeries(tenant.TransactionFromContext, tenant.IsAdminTx)
}
