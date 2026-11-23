package parentbillinghttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// HolidayRouteContracts registers the Elternabrechnung of the holiday care
// in the Träger-Portal (ADR 0270), with patterns relative to
// /traeger/holiday-contributions. A rebooking answers the registration as
// Enrollment shows it; the root names that type in registration.
func HolidayRouteContracts(registration any) []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	key := "/{periodId}/registrations/{registrationId}"
	preview := []common.QueryParam{{Name: "benefits_exemption", Kind: common.QueryBool}, {Name: "cost_bearer_id", Kind: common.QueryID}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/confirmation-settings", Portals: portals, Response: capability.HolidayConfirmationSettings{}},
		{Method: "GET", Pattern: key, Portals: portals, Query: preview, Response: HolidayContributionResponse{}},
		{Method: "POST", Pattern: key + "/confirm", Portals: portals, Request: HolidayConfirmRequest{}, Response: HolidayConfirmationResponse{}},
		{Method: "POST", Pattern: key + "/cancel", Portals: portals, Response: capability.HolidayCancellation{}},
		{Method: "PUT", Pattern: key + "/children/{childId}/bookings", Portals: portals, Request: HolidayRebookingRequest{}, Response: registration},
		{Method: "PUT", Pattern: "/{periodId}/weeks/{weekId}/capacity", Portals: portals, Request: HolidayCapacityRequest{}, Response: capability.HolidayPlaceChange{}},
		{Method: "PUT", Pattern: key + "/debtor-number", Portals: portals, Request: HolidayDebtorNumberRequest{}, Response: capability.HolidayDebtorNumber{}},
		{Method: "GET", Pattern: key + "/family-debtor-number", Portals: portals, Response: capability.HolidayFamilyDebtorNumber{}},
		{Method: "PUT", Pattern: key + "/child-debtor-numbers", Portals: portals, Request: HolidayChildDebtorNumbersRequest{}, Response: capability.HolidayFamilyDebtorNumber{}},
		{Method: "GET", Pattern: "/{periodId}/sibling-groups", Portals: portals, Response: []capability.HolidaySiblingGroup{}},
		{Method: "POST", Pattern: "/{periodId}/sibling-groups", Portals: portals, Request: HolidaySiblingMergeRequest{}, Response: capability.HolidaySiblingGroup{}},
		{Method: "DELETE", Pattern: "/{periodId}/sibling-groups/registrations/{registrationId}", Portals: portals, NoData: true},
	}
}

// holidayQuoteBodyBytes bounds the bookings of the public summary, which no
// session bounds: a few children with their weeks and days.
const holidayQuoteBodyBytes = 64 << 10

// HolidayQuoteRouteContracts registers the contribution the public holiday
// registration shows before it is sent (#4664), relative to
// /traeger/holiday-quotes. It runs without a session; the link names the
// Träger.
func HolidayQuoteRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "POST", Pattern: "/{token}", Portals: []common.PortalScope{common.PortalPublic}, Request: HolidayQuoteRequest{}, Response: capability.HolidayContribution{}, MaxBodyBytes: holidayQuoteBodyBytes},
	}
}
