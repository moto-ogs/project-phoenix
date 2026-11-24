package files

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// FolderRemovedResponse names the folder a delete of a folder or of one of
// its files touched.
type FolderRemovedResponse struct {
	FolderID ident.ID `json:"folder_id"`
}

// AttachmentRemovedResponse names the announcement whose attachment a delete
// removed, with the version the removal stamped on the draft (ADR 0311).
type AttachmentRemovedResponse struct {
	AnnouncementID      ident.ID `json:"announcement_id"`
	AnnouncementVersion string   `json:"announcement_version"`
}

// inlineQuery asks for in-browser viewing with inline=1; serveContent
// decides per content type.
var inlineQuery = []common.QueryParam{{Name: "inline", Kind: common.QueryString}}

// RouteContracts registers the typed contract of the school's file storage
// (ADR 0270), with patterns relative to /api/files. Uploads and downloads
// stream through the catalog (#2352).
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/folders/{folderId}/files/{fileId}/download", Portals: portals, Query: inlineQuery, File: true},
		{Method: "GET", Pattern: "/folders", Portals: portals, Response: FolderListResponse{}},
		{Method: "POST", Pattern: "/folders", Portals: portals, Request: FolderRequest{}, Response: FolderResponse{}},
		{Method: "GET", Pattern: "/audience", Portals: portals, Response: AudienceResponse{}},
		{Method: "PUT", Pattern: "/folders/{folderId}", Portals: portals, Request: FolderRequest{}, Response: FolderResponse{}},
		{Method: "DELETE", Pattern: "/folders/{folderId}", Portals: portals, Request: FolderRemovalRequest{}, Response: FolderRemovedResponse{}},
		{Method: "DELETE", Pattern: "/folders/{folderId}/files/{fileId}", Portals: portals, Response: FolderRemovedResponse{}},
		{Method: "GET", Pattern: "/folders/{folderId}/files", Portals: portals, Response: FileListResponse{}},
		{Method: "POST", Pattern: "/folders/{folderId}/files", Portals: portals, Multipart: true,
			MaxBodyBytes: maxBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: FileResponse{}},
	}
}

// AnnouncementAttachmentRouteContracts registers the attachments of the
// parent announcements, with patterns relative to
// /api/announcement-attachments. List, upload and download go through the
// catalog (#2352).
func AnnouncementAttachmentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{announcementId}/{attachmentId}/download", Portals: portals, Query: inlineQuery, File: true},
		{Method: "DELETE", Pattern: "/{announcementId}/{attachmentId}", Portals: portals, Request: AttachmentRemovalRequest{}, Response: AttachmentRemovedResponse{}},
		{Method: "GET", Pattern: "/{announcementId}", Portals: portals, Response: StaffAttachmentListResponse{}},
		{Method: "POST", Pattern: "/{announcementId}", Portals: portals, Multipart: true,
			Query:        []common.QueryParam{{Name: "expected_version", Kind: common.QueryString}},
			MaxBodyBytes: maxBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: UploadedAttachmentResponse{}},
	}
}

// ParentAnnouncementAttachmentRouteContracts registers the guardian's
// attachments, with patterns relative to /parent-news-attachments. The
// download answers the file; student_id names the child a declaration proof
// is for, inline=1 shows a picture or PDF in the tab.
func ParentAnnouncementAttachmentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{announcementId}", Portals: portals, Response: AnnouncementAttachmentListResponse{}},
		{
			Method: "GET", Pattern: "/{announcementId}/{attachmentId}/download", Portals: portals, File: true,
			Query: []common.QueryParam{{Name: "student_id", Kind: common.QueryID}, {Name: "inline", Kind: common.QueryString}},
		},
	}
}
