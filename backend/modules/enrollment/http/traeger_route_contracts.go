package enrollmenthttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// HolidayPeriodRouteContracts registers the Träger's holiday periods and
// their registrations (ADR 0270), with patterns relative to
// /traeger/holiday-periods. The office's proof upload streams through the
// catalog (#2352); the other files, uploads and exports keep their route
// files.
func HolidayPeriodRouteContracts() []common.RouteContract {
	registration := "/{id}/registrations/{registrationId}"
	filter := []common.QueryParam{
		{Name: "status", Kind: common.QueryString}, {Name: "school", Kind: common.QueryString},
		{Name: "time_model", Kind: common.QueryString}, {Name: "wish", Kind: common.QueryString},
		{Name: "week_id", Kind: common.QueryID},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/criteria", Portals: traegerPortal, Response: capability.HolidayCriteriaCatalog{}},
		{Method: "PUT", Pattern: "/criteria", Portals: traegerPortal, Request: HolidayCriteriaRequest{}, Response: capability.HolidayCriteriaCatalog{}},
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []capability.HolidayPeriod{}},
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
		{Method: "GET", Pattern: "/{id}/places", Portals: traegerPortal, Response: []capability.HolidayWeekPlaces{}},
		{Method: "GET", Pattern: "/{id}/allocation", Portals: traegerPortal, Response: capability.HolidayAllocationBoard{}},
		{Method: "POST", Pattern: "/{id}/allocation/decisions", Portals: traegerPortal, Request: HolidayAllocationRequest{}, Response: capability.HolidayAllocationBoard{}},
		{Method: "GET", Pattern: "/{id}/registrations", Portals: traegerPortal, Query: filter, Response: capability.HolidayRegistrationList{}},
		{Method: "GET", Pattern: "/{id}/registrations/known-children", Portals: traegerPortal,
			Query: []common.QueryParam{{Name: "registration_id", Kind: common.QueryID}}, Response: HolidayKnownChildrenResponse{}},
		{Method: "GET", Pattern: "/{id}/registrations/mail-problems", Portals: traegerPortal, Response: HolidayMailProblemsResponse{}},
		{Method: "GET", Pattern: registration, Portals: traegerPortal, Response: capability.HolidayRegistrationDetail{}},
		{Method: "GET", Pattern: registration + "/health", Portals: traegerPortal, Response: capability.HolidayRegistrationHealthDetail{}},
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
		{Method: "POST", Pattern: "/preview", Portals: traegerPortal, Request: HolidayClosurePreviewRequest{}, Response: capability.HolidayClosureImpact{}},
	}
}
