package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/application"
)

// NewTraegerMasterData builds the master data of a Träger (#4653, ADR 0112) in the Träger transaction (ADR 0105).
func NewTraegerMasterData() organizationtenancy.TraegerMasterData {
	return application.NewTraegerMasterData(postgres.NewTraegerMasterDataStore())
}

// NewTraegerBankAccountPresence builds the check for a bank account of a Träger (#7177) in the Träger transaction.
func NewTraegerBankAccountPresence() organizationtenancy.TraegerBankAccountPresence {
	return postgres.NewTraegerMasterDataStore()
}

// NewTraegerDocumentTemplates builds the document templates of a Träger (#4677, ADR 0152) in the Träger transaction.
func NewTraegerDocumentTemplates() organizationtenancy.TraegerDocumentTemplates {
	return application.NewTraegerDocumentTemplates(postgres.NewTraegerMasterDataStore())
}

// NewTraegerDocuments builds the Träger-Büro's shared documents (#4692).
func NewTraegerDocuments(dependencies organizationtenancy.TraegerDocumentPorts) organizationtenancy.TraegerDocuments {
	return application.NewTraegerDocuments(postgres.NewTraegerDocumentStore(), dependencies)
}

// NewSharedTraegerDocuments builds the parents' and schools' reads (#4692).
func NewSharedTraegerDocuments() *postgres.TraegerDocumentStore {
	return postgres.NewTraegerDocumentStore()
}

// NewTraegerReportTemplates builds the report templates of a Träger (#4716, ADR 0246) in the Träger transaction and the Träger projection's read of one in its administrative transaction.
func NewTraegerReportTemplates() (organizationtenancy.TraegerReportTemplates, organizationtenancy.TraegerReportTemplateReads) {
	return application.NewTraegerReportTemplates(postgres.NewTraegerMasterDataStore()), postgres.NewTraegerReportTemplateReads()
}
