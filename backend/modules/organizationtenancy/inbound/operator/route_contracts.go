package operator

import "github.com/moto-ogs/project-phoenix/api/common"

// BillingRouteContracts registers the typed contract of the billing key day
// (ADR 0270), with patterns relative to the /operator/billing mount.
func BillingRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/key-day", Portals: operator, Response: billingKeyDayResponse{}},
		{Method: "PUT", Pattern: "/key-day", Portals: operator, Request: updateBillingKeyDayRequest{}, Response: billingKeyDayResponse{}},
	}
}
