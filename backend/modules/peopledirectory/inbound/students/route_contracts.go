package students

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the People Directory's
// student routes (ADR 0270), with patterns relative to /api/students.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/child-quota", Portals: portals, Response: childQuotaResponse{}},
		{Method: "GET", Pattern: "/school-classes", Portals: portals, Response: []string{}},
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
		// The photo behind one upload URL never changes (serveStudentPhoto):
		// the viewer's browser keeps it and revalidates with a 304.
		{
			Method: "GET", Pattern: "/{id}/photo/{filename}", Portals: portals, File: true,
			FileCache: studentPhotoCacheControl, ConditionalGet: true,
		},
		{Method: "POST", Pattern: "/{id}/photo", Portals: portals, Multipart: true,
			MaxBodyBytes: maxStudentPhotoBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: studentPhotoUploadedResponse{}},
		{Method: "DELETE", Pattern: "/{id}/photo", Portals: portals, NoData: true},
	}
}

// DeviceRouteContracts keeps the kiosk's tag assignment outside the
// contract (#7808), relative to /api/students: PyrePortal calls it with the
// device key.
func DeviceRouteContracts() []common.RouteContract {
	return common.OutsideRoutes(common.OutsideDevice, "PyrePortal assigns and removes a tag with the device key and reads numeric IDs",
		"POST /{id}/rfid", "DELETE /{id}/rfid")
}
