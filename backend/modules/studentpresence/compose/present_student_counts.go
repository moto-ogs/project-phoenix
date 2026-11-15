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
