package catererportalhttp

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the caterer's own routes
// (ADR 0270), with patterns relative to the /caterer mount.
func RouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/schools",
			Portals:  []common.PortalScope{common.PortalCaterer},
			Response: SchoolsResponse{},
		},
		{
			Method: "GET", Pattern: "/schools/{schoolId}/orders",
			Portals:  []common.PortalScope{common.PortalCaterer},
			Query:    []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}},
			Response: SchoolOrdersResponse{},
		},
		{
			Method: "POST", Pattern: "/schools/{schoolId}/orders/{orderId}/confirm",
			Portals: []common.PortalScope{common.PortalCaterer},
			NoData:  true,
		},
		{
			Method: "POST", Pattern: "/account/password",
			Portals: []common.PortalScope{common.PortalCaterer},
			Request: changePasswordRequest{}, NoData: true,
			NoRetryAfterRenewal: "a renewed session would send the current password twice",
		},
		{
			Method: "GET", Pattern: "/orders/export",
			Portals: []common.PortalScope{common.PortalCaterer},
			Query:   exportQuery, File: true,
		},
	}
}

// exportQuery is what exportWindow reads for a delivery list.
var exportQuery = []common.QueryParam{
	{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
	{Name: "format", Kind: common.QueryString, Values: []string{"csv", "pdf", "xlsx"}},
}

// SupplyEndedResponse says whether ending the supply ended a running one.
type SupplyEndedResponse struct {
	Ended bool `json:"ended"`
}

// SchoolRouteContracts registers the school's side of its caterer, with
// patterns relative to /api/meal-caterer. The delivery list answers a file.
func SchoolRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: SchoolCatererResponse{}},
		{Method: "POST", Pattern: "/invitations", Portals: portals, Request: inviteRequest{}, Response: InvitationResponse{}},
		{Method: "DELETE", Pattern: "/invitations/{invitationId}", Portals: portals, NoData: true},
		{Method: "DELETE", Pattern: "/supply", Portals: portals, Response: SupplyEndedResponse{}},
		{Method: "GET", Pattern: "/orders/export", Portals: portals, Query: exportQuery, File: true},
	}
}

// acceptBodyBytes bounds the accept body: a password and its repetition.
const acceptBodyBytes = 4 << 10

// PublicRouteContracts registers the mailed invitation link, which a caterer
// opens without a session (#2352), relative to the /caterer mount.
func PublicRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalPublic}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/invitations/{schoolId}/{token}", Portals: portals, Response: PreviewResponse{}},
		{Method: "POST", Pattern: "/invitations/{schoolId}/{token}/accept", Portals: portals, Request: acceptRequest{}, NoData: true, MaxBodyBytes: acceptBodyBytes},
	}
}
