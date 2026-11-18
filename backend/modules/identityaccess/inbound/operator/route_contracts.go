package operator

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the operator's profile and the caterer list
// (ADR 0270, #2352), with patterns relative to the /operator mount.
func RouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/profile/", Portals: operator, Response: OperatorResponse{}},
		{Method: "PUT", Pattern: "/profile/", Portals: operator, Request: UpdateProfileRequest{}, Response: OperatorResponse{}},
		{Method: "GET", Pattern: "/caterers", Portals: operator, Response: []CatererSecurityResponse{}},
	}
}
