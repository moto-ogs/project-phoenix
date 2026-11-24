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
// The exports answer files (#2352); school= narrows one to a school.
func SchoolRouteContracts() []common.RouteContract {
	format := []common.QueryParam{common.ListFormatQuery}
	school := []common.QueryParam{common.ListFormatQuery, {Name: "school", Kind: common.QueryID}}
	comparison := append([]common.QueryParam{{Name: "schools", Kind: common.QueryID, Repeated: true}}, window...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []traegerview.TraegerSchool{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: format, File: true},
		{Method: "GET", Pattern: "/alerts", Portals: traegerPortal, Response: traegerview.SchoolsAlerts{}},
		{Method: "GET", Pattern: "/alerts/export", Portals: traegerPortal, Query: school, File: true},
		{Method: "GET", Pattern: "/occupancy", Portals: traegerPortal, Response: traegerview.Occupancy{}},
		{Method: "GET", Pattern: "/occupancy/export", Portals: traegerPortal, Query: school, File: true},
		{Method: "GET", Pattern: "/utilization", Portals: traegerPortal, Query: window, Response: traegerview.Utilization{}},
		{Method: "GET", Pattern: "/utilization/export", Portals: traegerPortal, Query: append(school, window...), File: true},
		{Method: "GET", Pattern: "/{id}/utilization/children", Portals: traegerPortal, Query: window, Response: traegerview.UtilizationChildren{}},
		{Method: "GET", Pattern: "/arrival-pickup-times", Portals: traegerPortal, Query: window, Response: traegerview.ArrivalPickupTimes{}},
		{Method: "GET", Pattern: "/arrival-pickup-times/export", Portals: traegerPortal, Query: append(school, window...), File: true},
		{Method: "GET", Pattern: "/daily-attendance", Portals: traegerPortal, Query: window, Response: traegerview.DailyAttendance{}},
		{Method: "GET", Pattern: "/daily-attendance/export", Portals: traegerPortal, Query: append(format, window...), File: true},
		{Method: "GET", Pattern: "/comparison", Portals: traegerPortal, Query: comparison, Response: traegerview.SchoolComparison{}},
		{Method: "GET", Pattern: "/comparison/export", Portals: traegerPortal,
			Query: append([]common.QueryParam{common.ListFormatQuery, {Name: "metrics", Kind: common.QueryString}}, comparison...), File: true},
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
	export := append([]common.QueryParam{common.ListFormatQuery}, filter...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: page, Response: traegerview.AccessLogPage{}},
		{Method: "GET", Pattern: "/people", Portals: traegerPortal, Query: window, Response: []traegerview.AccessLogPerson{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: export, File: true},
	}
}

// ReportRouteContracts registers the key-date report, with patterns
// relative to /traeger/reports. The export answers a file (#2352).
func ReportRouteContracts() []common.RouteContract {
	report := []common.QueryParam{{Name: "key_date", Kind: common.QueryDate}, {Name: "template", Kind: common.QueryID}}
	format := common.QueryParam{Name: "format", Kind: common.QueryString,
		Values: []string{traegerview.ReportFormatPDF, traegerview.ReportFormatXLSX, traegerview.ReportFormatCSV}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/key-date", Portals: traegerPortal, Query: report, Response: traegerview.KeyDateReport{}},
		{Method: "GET", Pattern: "/key-date/export", Portals: traegerPortal, Query: append([]common.QueryParam{format}, report...), File: true},
	}
}
