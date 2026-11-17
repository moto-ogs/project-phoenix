package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewPresentStudents composes the Träger's current children and care times (#5686, #4714).
func NewPresentStudents() studentpresence.TraegerPresence {
	return postgres.NewPresentStudents(tenant.TransactionFromContext, tenant.IsAdminTx)
}

// NewPresenceSeries composes the Träger's attendance and room days over time
// (#4713, ADR 0241) in its admin transaction, on the clock of the visits.
func NewPresenceSeries(now func() time.Time) studentpresence.PresenceSeries {
	return postgres.NewPresenceSeries(tenant.TransactionFromContext, tenant.IsAdminTx, now)
}
