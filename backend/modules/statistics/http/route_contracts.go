package statisticshttp

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// RouteContracts registers the statistics reads of the staff portal (#2352),
// with patterns relative to /api/statistics. The exports answer files.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	// parseFilters reads the range, the sections and both repeatable filters
	// for every route; group_id is comma-separated and 0 names the children
	// without a group.
	filters := []common.QueryParam{
		{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
		{Name: "section", Kind: common.QueryString, Repeated: true},
		{Name: "group_id", Kind: common.QueryID, Repeated: true},
		{Name: "school_class", Kind: common.QueryString, Repeated: true},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/report", Portals: portals, Query: filters, Response: reportResponse{}},
		{Method: "GET", Pattern: "/care-time-overruns", Portals: portals, Query: filters, Response: careTimeOverrunsResponse{}},
		{Method: "GET", Pattern: "/students/{id}/care-times", Portals: portals, Query: filters, Response: studentCareTimesResponse{}},
		// The report export reads ?section once more for the one sheet it
		// renders; the filters already name it.
		{Method: "GET", Pattern: "/export", Portals: portals, File: true,
			Query: withFormat(filters, string(formatPDF), string(formatDOCX), string(formatXLSX))},
		{Method: "GET", Pattern: "/care-time-overruns/export", Portals: portals, File: true,
			Query: withFormat(filters, string(formatPDF), string(formatXLSX))},
	}
}

// withFormat adds the closed ?format of an export to the filters.
func withFormat(filters []common.QueryParam, formats ...string) []common.QueryParam {
	return append(slices.Clone(filters), common.QueryParam{Name: "format", Kind: common.QueryString, Values: formats})
}
