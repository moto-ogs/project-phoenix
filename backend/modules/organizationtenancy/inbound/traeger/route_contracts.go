package traeger

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// MasterDataRouteContracts registers the typed contract of the Träger's
// master data (ADR 0270), with patterns relative to /traeger/master-data.
// The logo and the export of the templates answer a file and keep their
// route files.
func MasterDataRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: organizationtenancy.TraegerProfile{}},
		{Method: "PUT", Pattern: "/contact", Portals: traegerPortal, Request: ContactRequest{}, Response: organizationtenancy.TraegerContact{}},
		{Method: "PUT", Pattern: "/withdrawal-contact", Portals: traegerPortal, Request: WithdrawalContactRequest{}, Response: organizationtenancy.TraegerWithdrawalContact{}},
		{Method: "POST", Pattern: "/bank-accounts", Portals: traegerPortal, Request: BankAccountRequest{}, Response: organizationtenancy.TraegerBankAccount{}},
		{Method: "PUT", Pattern: "/bank-accounts/{id}", Portals: traegerPortal, Request: BankAccountRequest{}, Response: organizationtenancy.TraegerBankAccount{}},
		{Method: "DELETE", Pattern: "/bank-accounts/{id}", Portals: traegerPortal, NoData: true},
		{Method: "GET", Pattern: "/document-templates", Portals: traegerPortal, Response: []organizationtenancy.TraegerDocumentTemplateSummary{}},
		{Method: "GET", Pattern: "/document-templates/{kind}", Portals: traegerPortal, Response: organizationtenancy.TraegerDocumentTemplateDetail{}},
		{Method: "POST", Pattern: "/document-templates/{kind}/versions", Portals: traegerPortal, Request: TemplateRequest{}, Response: organizationtenancy.TraegerDocumentTemplate{}},
		{Method: "POST", Pattern: "/document-templates/{kind}/preview", Portals: traegerPortal, Request: TemplateRequest{}, Response: templates.SampleLetter{}},
	}
}

// DocumentRouteContracts registers the typed contract of the Träger's
// documents, with patterns relative to /traeger/documents. The list shares
// its route file with the upload, and the file and the export answer bytes.
func DocumentRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/audiences", Portals: traegerPortal, Response: []organizationtenancy.TraegerDocumentSchool{}},
		{Method: "POST", Pattern: "/{id}/releases", Portals: traegerPortal, Request: ReleaseRequest{}, Response: organizationtenancy.TraegerDocumentRelease{}},
		{Method: "DELETE", Pattern: "/{id}/releases/{releaseId}", Portals: traegerPortal, NoData: true},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, NoData: true},
	}
}

// ReportTemplateRouteContracts registers the typed contract of the report
// templates, with patterns relative to /traeger/report-templates.
func ReportTemplateRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []organizationtenancy.TraegerReportTemplate{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: ReportTemplateRequest{}, Response: organizationtenancy.TraegerReportTemplate{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: ReportTemplateRequest{}, Response: organizationtenancy.TraegerReportTemplate{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, NoData: true},
	}
}
