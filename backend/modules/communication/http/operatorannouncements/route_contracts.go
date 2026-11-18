package operatorannouncements

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/communication"
)

// RouteContracts registers the operator announcements, their publication
// and their view statistics (ADR 0270, #2352), relative to the
// /operator/announcements mount.
func RouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: operator, Query: []common.QueryParam{{Name: "include_inactive", Kind: common.QueryBool}}, Response: []OperatorAnnouncementResponse{}},
		{Method: "POST", Pattern: "/", Portals: operator, Request: CreateAnnouncementRequest{}, Response: OperatorAnnouncementResponse{}},
		{Method: "GET", Pattern: "/{id}", Portals: operator, Response: OperatorAnnouncementResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: operator, Request: UpdateAnnouncementRequest{}, Response: OperatorAnnouncementResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: operator, NoData: true},
		{Method: "POST", Pattern: "/{id}/publish", Portals: operator, NoData: true},
		{Method: "GET", Pattern: "/{id}/stats", Portals: operator, Response: communication.AnnouncementStats{}},
		{Method: "GET", Pattern: "/{id}/views", Portals: operator, Response: []AnnouncementViewDetailResponse{}},
	}
}
