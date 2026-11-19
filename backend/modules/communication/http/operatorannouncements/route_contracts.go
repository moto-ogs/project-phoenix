package operatorannouncements

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// RouteContracts registers the publication and the view statistics of an
// operator announcement (ADR 0270, #2352), relative to the
// /operator/announcements mount.
func RouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/{id}/publish", Portals: operator, NoData: true},
		{Method: "GET", Pattern: "/{id}/stats", Portals: operator, Response: communication.AnnouncementStats{}},
		{Method: "GET", Pattern: "/{id}/views", Portals: operator, Response: []AnnouncementViewDetailResponse{}},
	}
}
