package traeger

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// MasterDataRouteContracts registers the typed contract of the Träger's
// master data (ADR 0270), with patterns relative to /traeger/master-data.
// The export of the templates answers a file (#2352); the logo keeps its
// route file.
func MasterDataRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: organizationtenancy.TraegerProfile{}},
		{Method: "PUT", Pattern: "/contact", Portals: traegerPortal, Request: ContactRequest{}, Response: organizationtenancy.TraegerContact{}},
		{Method: "PUT", Pattern: "/withdrawal-contact", Portals: traegerPortal, Request: WithdrawalContactRequest{}, Response: organizationtenancy.TraegerWithdrawalContact{}},
		{Method: "POST", Pattern: "/bank-accounts", Portals: traegerPortal, Request: BankAccountRequest{}, Response: organizationtenancy.TraegerBankAccount{}},
		{Method: "PUT", Pattern: "/bank-accounts/{id}", Portals: traegerPortal, Request: BankAccountRequest{}, Response: organizationtenancy.TraegerBankAccount{}},
		{Method: "DELETE", Pattern: "/bank-accounts/{id}", Portals: traegerPortal, NoData: true},
		{Method: "GET", Pattern: "/document-templates", Portals: traegerPortal, Response: []organizationtenancy.TraegerDocumentTemplateSummary{}},
		{Method: "GET", Pattern: "/document-templates/export", Portals: traegerPortal, Query: []common.QueryParam{common.ListFormatQuery}, File: true},
		{Method: "GET", Pattern: "/document-templates/{kind}", Portals: traegerPortal, Response: organizationtenancy.TraegerDocumentTemplateDetail{}},
		{Method: "POST", Pattern: "/document-templates/{kind}/versions", Portals: traegerPortal, Request: TemplateRequest{}, Response: organizationtenancy.TraegerDocumentTemplate{}},
		{Method: "POST", Pattern: "/document-templates/{kind}/preview", Portals: traegerPortal, Request: TemplateRequest{}, Response: templates.SampleLetter{}},
	}
}

// DocumentRouteContracts registers the typed contract of the Träger's
// documents, with patterns relative to /traeger/documents. The upload is
// multipart; the export and document files stream through the catalog (#2352).
func DocumentRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []organizationtenancy.TraegerDocument{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Multipart: true,
			MaxBodyBytes: maxDocumentBody, TooLargeCode: common.CodeFilesFileTooLarge,
			Response: organizationtenancy.TraegerDocument{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: []common.QueryParam{common.ListFormatQuery}, File: true},
		{Method: "GET", Pattern: "/{id}/file", Portals: traegerPortal, File: true},
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

// SchoolDocumentRouteContracts registers the documents a Träger released
// for the school (#4692), with patterns relative to /api/traeger-documents
// of the staff portal. The file answers bytes and keeps its route file.
func SchoolDocumentRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: []common.PortalScope{common.PortalTenant}, Response: []organizationtenancy.SharedDocument{}},
	}
}
