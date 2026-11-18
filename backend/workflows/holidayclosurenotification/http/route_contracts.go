package http

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	notification "github.com/moto-ogs/project-phoenix/workflows/holidayclosurenotification"
)

// TraegerRouteContracts registers the Träger-Büro's list "Eltern noch nicht
// informiert" (ADR 0270), with patterns relative to
// /traeger/holiday-closures/pending.
func TraegerRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: notification.Pending{}},
		{Method: "POST", Pattern: "/notify", Portals: portals, Request: NotifyAllRequest{}, Response: notification.NotifiedPending{}},
		{Method: "POST", Pattern: "/{id}/notify", Portals: portals, Request: NotifyRequest{}, Response: notification.Notice{}},
	}
}
