package exporttransferhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/exporttransfer"
)

// RecipientRouteContracts registers the recipients of the finance exports
// and the assignment of the formats to them (ADR 0270), with patterns
// relative to /traeger/export-recipient. Removing a recipient answers the
// page without it.
func RecipientRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: exporttransfer.TraegerRecipientsPage{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: RecipientRequest{}, Response: exporttransfer.TraegerRecipient{}},
		{Method: "PUT", Pattern: "/formats", Portals: portals, Request: FormatsRequest{}, Response: exporttransfer.TraegerRecipientsPage{}},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: exporttransfer.TraegerRecipientPage{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: RecipientRequest{}, Response: exporttransfer.TraegerRecipient{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, Response: exporttransfer.TraegerRecipientsPage{}},
	}
}
