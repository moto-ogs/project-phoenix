package parentbillinghttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// RequiredDetailsRouteContracts registers the details the Träger still has
// to enter (#7177, ADR 0270), with patterns relative to
// /traeger/required-details.
func RequiredDetailsRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: []common.PortalScope{common.PortalTraeger}, Response: capability.RequiredDetails{}},
	}
}
