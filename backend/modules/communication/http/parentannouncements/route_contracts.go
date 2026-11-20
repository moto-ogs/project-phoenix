package announcement

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the parent announcements a
// portal mounts (ADR 0270), with patterns relative to the mount:
// /api/parent-announcements in the staff portal, /school/parent-letters in
// moto schule. A Lehrkraft writes class letters only; changing a draft, polls,
// the scheduled reminder and the Kinderakte belong to the staff portal.
//
// The PDF and CSV downloads answer a file and keep their route files. The
// body of PUT /{announcementId}/reminder keeps reminder_at as raw JSON, so
// the handler tells an omitted reminder_at from an explicit null.
func RouteContracts(portal common.PortalScope) []common.RouteContract {
	portals := []common.PortalScope{portal}
	tenant := portal == common.PortalTenant
	var listQuery []common.QueryParam
	if tenant {
		listQuery = []common.QueryParam{{Name: "include_inactive", Kind: common.QueryBool}}
	}
	routes := []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: listQuery, Response: []announcementResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: announcementRequest{}, Response: announcementResponse{}},
		{Method: "GET", Pattern: "/letter-placeholders", Portals: portals, Response: []letterPlaceholderResponse{}},
		{Method: "POST", Pattern: "/letter-preview", Portals: portals, Request: letterPreviewRequest{}, Response: letterPreviewResponse{}},
		{Method: "GET", Pattern: "/{announcementId}", Portals: portals, Response: announcementResponse{}},
		{Method: "DELETE", Pattern: "/{announcementId}", Portals: portals, Response: deletedResponse{}},
		{Method: "POST", Pattern: "/{announcementId}/publish", Portals: portals, Response: announcementResponse{}},
		{Method: "POST", Pattern: "/{announcementId}/unpublish", Portals: portals, Response: announcementResponse{}},
		{Method: "GET", Pattern: "/{announcementId}/stats", Portals: portals, Response: statsResponse{}},
		{Method: "GET", Pattern: "/{announcementId}/recipients", Portals: portals, Response: []recipientResponse{}},
		{Method: "GET", Pattern: "/{announcementId}/letter-status", Portals: portals, Response: letterStatusResponse{}},
		{Method: "GET", Pattern: "/{announcementId}/declaration-status", Portals: portals, Response: declarationStatusResponse{}},
		{Method: "POST", Pattern: "/{announcementId}/remind", Portals: portals, Response: remindedResponse{}},
		{Method: "POST", Pattern: "/{announcementId}/resend-failed", Portals: portals, Response: resentResponse{}},
		// The printable letters and the declaration report (csv history or
		// pdf proof, one child with student_id) answer files (#2352).
		{Method: "GET", Pattern: "/{announcementId}/letters-pdf", Portals: portals, File: true},
		{
			Method: "GET", Pattern: "/{announcementId}/declaration-export", Portals: portals, File: true,
			Query: []common.QueryParam{
				{Name: "format", Kind: common.QueryString, Values: []string{"csv", "pdf"}},
				{Name: "student_id", Kind: common.QueryID},
			},
		},
	}
	if !tenant {
		return routes
	}
	return append(routes,
		common.RouteContract{Method: "PUT", Pattern: "/{announcementId}", Portals: portals, Request: announcementRequest{}, Response: announcementResponse{}},
		common.RouteContract{Method: "PUT", Pattern: "/{announcementId}/reminder", Portals: portals, Request: reminderRequest{}, Response: announcementResponse{}},
		common.RouteContract{Method: "GET", Pattern: "/{announcementId}/poll-results", Portals: portals, Response: pollResultsResponse{}},
		common.RouteContract{Method: "GET", Pattern: "/{announcementId}/poll-children", Portals: portals, Response: []pollChildResponse{}},
		common.RouteContract{Method: "GET", Pattern: "/students/{studentId}", Portals: portals, Response: studentRecordsResponse{}},
	)
}

// deletedResponse, remindedResponse and resentResponse are the small answers
// of a write that returns no announcement.
type deletedResponse struct {
	Deleted bool `json:"deleted"`
}

type remindedResponse struct {
	RemindedCount int `json:"reminded_count"`
}

type resentResponse struct {
	ResentCount int `json:"resent_count"`
}
