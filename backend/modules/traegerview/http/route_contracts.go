package traegerviewhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// window is the period of a report: from and to as YYYY-MM-DD.
var window = []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}

// SchoolRouteContracts registers the Träger's overview of its schools and
// the reports on them (ADR 0270), with patterns relative to /traeger/schools.
// The exports answer files and keep their route files.
func SchoolRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []traegerview.TraegerSchool{}},
		{Method: "GET", Pattern: "/alerts", Portals: traegerPortal, Response: traegerview.SchoolsAlerts{}},
		{Method: "GET", Pattern: "/occupancy", Portals: traegerPortal, Response: traegerview.Occupancy{}},
		{Method: "GET", Pattern: "/utilization", Portals: traegerPortal, Query: window, Response: traegerview.Utilization{}},
		{Method: "GET", Pattern: "/{id}/utilization/children", Portals: traegerPortal, Query: window, Response: traegerview.UtilizationChildren{}},
		{Method: "GET", Pattern: "/arrival-pickup-times", Portals: traegerPortal, Query: window, Response: traegerview.ArrivalPickupTimes{}},
		{Method: "GET", Pattern: "/daily-attendance", Portals: traegerPortal, Query: window, Response: traegerview.DailyAttendance{}},
		{Method: "GET", Pattern: "/comparison", Portals: traegerPortal,
			Query: append([]common.QueryParam{{Name: "schools", Kind: common.QueryString}}, window...), Response: traegerview.SchoolComparison{}},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: traegerview.SchoolView{}},
	}
}

// OrganizationRouteContracts registers the Träger of the session as the
// portal frame reads it, with patterns relative to /traeger/organization.
func OrganizationRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: TraegerFrame{}},
	}
}

// AccessLogRouteContracts registers the access log of the Träger's schools,
// with patterns relative to /traeger/access-log. The export answers a file
// (#2352).
func AccessLogRouteContracts() []common.RouteContract {
	filter := append([]common.QueryParam{
		{Name: "kind", Kind: common.QueryString}, {Name: "as_of", Kind: common.QueryString},
		{Name: "school_id", Kind: common.QueryID}, {Name: "account_id", Kind: common.QueryID},
	}, window...)
	page := append([]common.QueryParam{{Name: "page", Kind: common.QueryInt}}, filter...)
	export := append([]common.QueryParam{{Name: "format", Kind: common.QueryString, Values: listFormats}}, filter...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: page, Response: traegerview.AccessLogPage{}},
		{Method: "GET", Pattern: "/people", Portals: traegerPortal, Query: window, Response: []traegerview.AccessLogPerson{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: export, File: true},
	}
}

// listFormats are the formats of common.ParseListFormat.
var listFormats = []string{common.ListFormatCSV, common.ListFormatPDF, common.ListFormatXLSX}

// ReportRouteContracts registers the key-date report, with patterns
// relative to /traeger/reports. The export answers a file.
func ReportRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/key-date", Portals: traegerPortal,
			Query: []common.QueryParam{{Name: "key_date", Kind: common.QueryDate}, {Name: "template", Kind: common.QueryID}}, Response: traegerview.KeyDateReport{}},
	}
}
