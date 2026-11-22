package enrollmenthttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// HolidayPeriodRouteContracts registers the Träger's holiday periods and
// their registrations (ADR 0270), with patterns relative to
// /traeger/holiday-periods. Exports, PDFs, proofs and form documents answer
// files; proof and form document uploads stream through the catalog (#2352).
func HolidayPeriodRouteContracts() []common.RouteContract {
	registration := "/{id}/registrations/{registrationId}"
	filter := []common.QueryParam{
		{Name: "status", Kind: common.QueryString}, {Name: "school", Kind: common.QueryString},
		{Name: "time_model", Kind: common.QueryString}, {Name: "wish", Kind: common.QueryString},
		{Name: "week_id", Kind: common.QueryID},
	}
	format := []common.QueryParam{common.ListFormatQuery}
	health := common.QueryParam{Name: "health", Kind: common.QueryBool}
	registrationExport := append([]common.QueryParam{{Name: "format", Kind: common.QueryString,
		Values: []string{string(lists.FormatPDF), string(lists.FormatXLSX), string(lists.FormatCSV)}}}, filter...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/criteria", Portals: traegerPortal, Response: capability.HolidayCriteriaCatalog{}},
		{Method: "PUT", Pattern: "/criteria", Portals: traegerPortal, Request: HolidayCriteriaRequest{}, Response: capability.HolidayCriteriaCatalog{}},
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.HolidayPeriod{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: format, File: true},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: HolidayPeriodRequest{}, Response: capability.HolidayPeriod{}},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: capability.HolidayPeriod{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: HolidayPeriodRequest{}, Response: capability.HolidayPeriod{}},
		{Method: "POST", Pattern: "/{id}/publish", Portals: traegerPortal, Response: capability.HolidayPeriod{}},
		{Method: "GET", Pattern: "/{id}/form", Portals: traegerPortal, Response: capability.HolidayFormEditor{}},
		// The body is the editor's own form (fields, legal blocks), the same
		// Enrollment types the answer carries; a type the generator walks
		// once as a request and once as a response it refuses, so the body
		// stays unregistered here.
		{Method: "PUT", Pattern: "/{id}/form", Portals: traegerPortal, Response: capability.HolidayFormEditor{}},
		{Method: "POST", Pattern: "/{id}/form/documents", Portals: traegerPortal, Multipart: true,
			MaxBodyBytes: maxEnrollmentLegalDocumentBody, TooLargeCode: common.CodeEnrollmentLegalDocumentInvalid,
			Response: capability.HolidayFormDocument{}},
		{Method: "GET", Pattern: "/{id}/form/documents/{documentId}", Portals: traegerPortal, File: true},
		{Method: "DELETE", Pattern: "/{id}/form/documents/{documentId}", Portals: traegerPortal, NoData: true},
		{Method: "GET", Pattern: "/{id}/places", Portals: traegerPortal, Response: []capability.HolidayWeekPlaces{}},
		{Method: "GET", Pattern: "/{id}/places/export", Portals: traegerPortal, Query: format, File: true},
		{Method: "GET", Pattern: "/{id}/allocation", Portals: traegerPortal, Response: capability.HolidayAllocationBoard{}},
		{Method: "GET", Pattern: "/{id}/allocation/export", Portals: traegerPortal, Query: format, File: true},
		{Method: "POST", Pattern: "/{id}/allocation/decisions", Portals: traegerPortal, Request: HolidayAllocationRequest{}, Response: capability.HolidayAllocationBoard{}},
		{Method: "GET", Pattern: "/{id}/registrations", Portals: traegerPortal, Query: filter, Response: capability.HolidayRegistrationList{}},
		{Method: "GET", Pattern: "/{id}/registrations/export", Portals: traegerPortal, Query: registrationExport, File: true},
		{Method: "GET", Pattern: "/{id}/registrations/pdf", Portals: traegerPortal, Query: append([]common.QueryParam{health}, filter...), File: true},
		{Method: "GET", Pattern: "/{id}/registrations/known-children", Portals: traegerPortal,
			Query: []common.QueryParam{{Name: "registration_id", Kind: common.QueryID}}, Response: HolidayKnownChildrenResponse{}},
		{Method: "GET", Pattern: "/{id}/registrations/mail-problems", Portals: traegerPortal, Response: HolidayMailProblemsResponse{}},
		{Method: "GET", Pattern: registration, Portals: traegerPortal, Response: capability.HolidayRegistrationDetail{}},
		{Method: "GET", Pattern: registration + "/health", Portals: traegerPortal, Response: capability.HolidayRegistrationHealthDetail{}},
		{Method: "GET", Pattern: registration + "/pdf", Portals: traegerPortal, Query: []common.QueryParam{health}, File: true},
		{Method: "GET", Pattern: registration + "/proofs/{proofId}", Portals: traegerPortal, File: true},
		{Method: "POST", Pattern: registration + "/freeze", Portals: traegerPortal, Response: capability.HolidayRegistrationDetail{}},
		{Method: "POST", Pattern: registration + "/reopen", Portals: traegerPortal, Response: capability.HolidayRegistrationDetail{}},
		{Method: "PUT", Pattern: registration + "/children/{childId}/holiday-wish", Portals: traegerPortal, Request: HolidayWishRequest{}, Response: capability.HolidayRegistrationDetail{}},
		{Method: "PUT", Pattern: registration + "/details", Portals: traegerPortal, Request: HolidayRegistrationEditRequest{}, Response: capability.HolidayRegistrationDetail{}},
		{Method: "PUT", Pattern: registration + "/criteria", Portals: traegerPortal, Request: HolidayCriteriaCheckRequest{}, Response: capability.HolidayRegistrationDetail{}},
		{Method: "POST", Pattern: registration + "/proofs", Portals: traegerPortal, Multipart: true,
			MaxBodyBytes: int(maxEnrollmentUploadBody), TooLargeCode: common.CodeEnrollmentUploadInvalid,
			Response: capability.HolidayRegistrationDetail{}},
	}
}

// HolidayClosureRouteContracts registers the preview of the holiday
// bookings a closing day touches (#6434), with patterns relative to
// /traeger/holiday-closures.
func HolidayClosureRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "POST", Pattern: "/preview", Portals: traegerPortal, Request: HolidayClosurePreviewRequest{}, NoCommit: "the preview counts the bookings a closure would touch and saves nothing", Response: capability.HolidayClosureImpact{}},
	}
}
