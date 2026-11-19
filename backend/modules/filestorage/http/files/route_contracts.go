package files

import "github.com/moto-ogs/project-phoenix/api/common"

// FolderRemovedResponse names the folder a delete of a folder or of one of
// its files touched.
type FolderRemovedResponse struct {
	FolderID string `json:"folder_id"`
}

// AttachmentRemovedResponse names the announcement whose attachment a delete
// removed.
type AttachmentRemovedResponse struct {
	AnnouncementID string `json:"announcement_id"`
}

// RouteContracts registers the typed contract of the school's file storage
// (ADR 0270), with patterns relative to /api/files. The upload streams
// through the catalog (#2352); the download keeps its route file.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/folders", Portals: portals, Response: FolderListResponse{}},
		{Method: "POST", Pattern: "/folders", Portals: portals, Request: FolderRequest{}, Response: FolderResponse{}},
		{Method: "GET", Pattern: "/audience", Portals: portals, Response: AudienceResponse{}},
		{Method: "PUT", Pattern: "/folders/{folderId}", Portals: portals, Request: FolderRequest{}, Response: FolderResponse{}},
		{Method: "DELETE", Pattern: "/folders/{folderId}", Portals: portals, Response: FolderRemovedResponse{}},
		{Method: "DELETE", Pattern: "/folders/{folderId}/files/{fileId}", Portals: portals, Response: FolderRemovedResponse{}},
		{Method: "GET", Pattern: "/folders/{folderId}/files", Portals: portals, Response: FileListResponse{}},
		{Method: "POST", Pattern: "/folders/{folderId}/files", Portals: portals, Multipart: true,
			MaxBodyBytes: maxBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: FileResponse{}},
	}
}

// AnnouncementAttachmentRouteContracts registers the attachments of the
// parent announcements, with patterns relative to
// /api/announcement-attachments. List and upload go through the catalog
// (#2352); the download keeps its route file.
func AnnouncementAttachmentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "DELETE", Pattern: "/{announcementId}/{attachmentId}", Portals: portals, Response: AttachmentRemovedResponse{}},
		{Method: "GET", Pattern: "/{announcementId}", Portals: portals, Response: AnnouncementAttachmentListResponse{}},
		{Method: "POST", Pattern: "/{announcementId}", Portals: portals, Multipart: true,
			MaxBodyBytes: maxBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: AnnouncementAttachmentResponse{}},
	}
}

// ParentAnnouncementAttachmentRouteContracts registers the guardian's
// attachment list, with patterns relative to /parent-news-attachments. The
// download answers a file and keeps its route file.
func ParentAnnouncementAttachmentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{announcementId}", Portals: portals, Response: AnnouncementAttachmentListResponse{}},
	}
}
