package birthdays

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
)

// RouteContracts registers the birthday overview and the personal opt-out
// (#2352), with patterns relative to /api/birthdays. The staff export
// answers a file that streams through the catalog proxy.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: []common.QueryParam{{Name: "week_start", Kind: common.QueryDate}}, Response: overviewResponse{}},
		{Method: "GET", Pattern: "/opt-out", Portals: portals, Response: optOutResponse{}},
		{Method: "PUT", Pattern: "/opt-out", Portals: portals, Request: optOutRequest{}, Response: optOutResponse{}},
		{
			Method: "POST", Pattern: "/staff-export", Portals: portals, Request: staffExportRequest{}, File: true,
			Enums: []common.EnumContract{{Name: "ListFormat", Type: lists.Format(""), Values: []string{string(lists.FormatPDF), string(lists.FormatDOCX), string(lists.FormatXLSX), string(lists.FormatCSV)}}},
		},
	}
}
