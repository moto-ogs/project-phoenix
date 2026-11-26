package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/adapters/postgres"
)

// NewContractOfferingChanges reads a school's approved offering changes for the Träger's contracts (#4816, ADR 0322) in that school's tenant transaction.
func NewContractOfferingChanges() careplan.ContractOfferingChanges {
	return postgres.NewContractOfferingChangeStore()
}
