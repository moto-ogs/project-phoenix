package students

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the People Directory's
// student routes (ADR 0270), with patterns relative to /api/students.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/child-quota", Portals: portals, Response: childQuotaResponse{}},
		{Method: "GET", Pattern: "/{id}/change-history", Portals: portals, Response: []changeHistoryEntry{}},
		{
			Method: "GET", Pattern: "/{id}/notes", Portals: portals,
			Query:    []common.QueryParam{{Name: "kind", Kind: common.QueryString}},
			Response: []studentNoteResponse{},
		},
		{Method: "GET", Pattern: "/{id}/note-subjects", Portals: portals, Response: noteSubjectsResponse{}},
		{Method: "POST", Pattern: "/{id}/notes", Portals: portals, Request: studentNoteRequestBody{}, Response: studentNoteResponse{}},
		{Method: "PUT", Pattern: "/{id}/notes/{noteId}", Portals: portals, Request: studentNoteRequestBody{}, Response: studentNoteResponse{}},
		{Method: "DELETE", Pattern: "/{id}/notes/{noteId}", Portals: portals, Response: studentNoteDeletedResponse{}},
		{Method: "POST", Pattern: "/{id}/notes/{noteId}/team-notices", Portals: portals, Response: studentNoteTeamInformedResponse{}},
		{Method: "GET", Pattern: "/team-notices", Portals: portals, Response: []studentNoteTeamNoticeResponse{}},
		{Method: "POST", Pattern: "/{id}/team-notices/read", Portals: portals, Request: studentNoteTeamReadRequest{}, Response: []studentNoteTeamNoticeResponse{}},
		{Method: "GET", Pattern: "/{id}/family-protection", Portals: portals, Response: familyProtectionResponse{}},
		{Method: "PUT", Pattern: "/{id}/family-protection", Portals: portals, Request: setFamilyProtectionBody{}, Response: familyProtectionResponse{}},
	}
}
