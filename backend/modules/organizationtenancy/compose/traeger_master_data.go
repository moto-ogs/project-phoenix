package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/application"
)

// NewTraegerMasterData builds the master data of a Träger (#4653, ADR 0112) in the Träger transaction (ADR 0105).
func NewTraegerMasterData() organizationtenancy.TraegerMasterData {
	return application.NewTraegerMasterData(postgres.NewTraegerMasterDataStore())
}

// NewTraegerDocumentTemplates builds the document templates of a Träger (#4677, ADR 0152) in the Träger transaction.
func NewTraegerDocumentTemplates() organizationtenancy.TraegerDocumentTemplates {
	return application.NewTraegerDocumentTemplates(postgres.NewTraegerMasterDataStore())
}

// NewTraegerDocuments builds the Träger-Büro's shared documents (#4692); the
// real clock stamps revocations and deletions, the root sets none (ADR 0272).
func NewTraegerDocuments(dependencies organizationtenancy.TraegerDocumentPorts) organizationtenancy.TraegerDocuments {
	return application.NewTraegerDocuments(postgres.NewTraegerDocumentStore(time.Now), dependencies)
}

// NewSharedTraegerDocuments builds the parents' and schools' reads (#4692).
func NewSharedTraegerDocuments() *postgres.TraegerDocumentStore {
	return postgres.NewTraegerDocumentStore(time.Now)
}

// NewTraegerReportTemplates builds the report templates of a Träger (#4716, ADR 0246) in the Träger transaction and the Träger projection's read of one in its administrative transaction.
func NewTraegerReportTemplates() (organizationtenancy.TraegerReportTemplates, organizationtenancy.TraegerReportTemplateReads) {
	return application.NewTraegerReportTemplates(postgres.NewTraegerMasterDataStore()), postgres.NewTraegerReportTemplateReads()
}

// NewSchoolResponsibilities builds the responsibilities at the schools of a Träger (#4811, ADR 0318) in the Träger transaction; the root binds settings to the Settings Platform.
func NewSchoolResponsibilities(settings organizationtenancy.SchoolResponsibilitySettings) organizationtenancy.SchoolResponsibilities {
	return application.NewSchoolResponsibilities(postgres.NewTraegerMasterDataStore(), settings)
}
