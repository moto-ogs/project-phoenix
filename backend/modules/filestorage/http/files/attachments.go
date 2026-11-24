package files

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/filestorage"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
)

// Anhänge an Elternmitteilungen (#2890).
//
// Warum diese Routen hier liegen und nicht bei der Mitteilung: die Bytes einer
// hochgeladenen Datei sind Sache der Dateiablage. Die Mitteilung steuert nur
// bei, wer die Datei sehen darf, und tut das über einen Port des Owners.
//
// Der Anhang geht bewusst NICHT mit der E-Mail raus. Elternmitteilungen kennen
// zwei E-Mail-Empfängerkreise, und "alle Bezugspersonen" erreicht auch Adressen
// ohne Portalzugang. Ein Anhang an eine solche Adresse würde genau die
// Zugangskontrolle umgehen, die "nur mit Portalzugang" herstellt.

// Beide Meldungen erreichen eine Person in der Schule und sagen, was als
// Nächstes zu tun ist, nicht nur, dass etwas fehlgeschlagen ist.
var (
	errAnnouncementPublished = errors.New("die Mitteilung ist schon veröffentlicht. Ziehe sie zurück, um Anhänge zu ändern")
	errAttachmentLimit       = errors.New("diese Mitteilung hat schon die höchstmögliche Zahl an Anhängen")
)

// AnnouncementAttachmentResponse is one attachment on the wire.
type AnnouncementAttachmentResponse struct {
	ID          ident.ID  `json:"id"`
	Filename    string    `json:"filename"`
	SizeBytes   int64     `json:"size_bytes" contract:"number"`
	ContentType string    `json:"content_type"`
	UploadedAt  time.Time `json:"uploaded_at"`
}

// AnnouncementAttachmentListResponse is the attachment list of one
// announcement, together with the limits the UI must state BEFORE somebody
// picks a file. Editable is false once the announcement is published; es
// bleibt true, wenn nur die Höchstzahl erreicht ist.
type AnnouncementAttachmentListResponse struct {
	Attachments []AnnouncementAttachmentResponse `json:"attachments"`
	MaxCount    int                              `json:"max_count"`
	MaxBytes    int64                            `json:"max_bytes" contract:"number"`
	Editable    bool                             `json:"editable"`
}

// StaffAttachmentListResponse is the staff side's list: the parents' list
// with the version of the draft it belongs to (ADR 0311). The editor
// publishes only once the list it shows belongs to the draft it sends.
type StaffAttachmentListResponse struct {
	AnnouncementAttachmentListResponse
	AnnouncementVersion string `json:"announcement_version"`
}

// UploadedAttachmentResponse is a new attachment with the version the upload
// stamped on its draft: the next save or publication of the draft sends it
// (ADR 0311).
type UploadedAttachmentResponse struct {
	AnnouncementAttachmentResponse
	AnnouncementVersion string `json:"announcement_version"`
}

// AttachmentRemovalRequest carries the version of the draft an attachment
// is removed from (ADR 0311).
type AttachmentRemovalRequest struct {
	ExpectedVersion string `json:"expected_version"`
}

func newAttachmentResponse(attachment filestorage.Attachment) AnnouncementAttachmentResponse {
	return AnnouncementAttachmentResponse{
		ID:          ident.ID(attachment.ID),
		Filename:    attachment.Filename,
		SizeBytes:   attachment.SizeBytes,
		ContentType: attachment.ContentType,
		UploadedAt:  attachment.UploadedAt,
	}
}

func newAttachmentListResponse(attachments []filestorage.Attachment, editable bool) *AnnouncementAttachmentListResponse {
	resp := &AnnouncementAttachmentListResponse{
		Attachments: make([]AnnouncementAttachmentResponse, 0, len(attachments)),
		MaxCount:    filestorage.MaxAnnouncementAttachments,
		MaxBytes:    maxFile,
		Editable:    editable,
	}
	for _, attachment := range attachments {
		resp.Attachments = append(resp.Attachments, newAttachmentResponse(attachment))
	}
	return resp
}

// AnnouncementAttachmentRouter serves the staff side under
// /api/announcement-attachments. It is gated on the same permission as the
// announcements themselves (#1669): who may write an Elternmitteilung may
// attach a file to it.
func (rs *Resource) AnnouncementAttachmentRouter(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	protectedTenantRoutes(r, func(r chi.Router, withTx common.Middleware) {
		admin := common.RequiresPermission(permissions.AdminWildcard)

		r.With(admin, withTx).Get("/{announcementId}", rs.listAnnouncementAttachments)
		r.With(admin).Post("/{announcementId}", rs.uploadAnnouncementAttachment)
		r.With(admin).Get("/{announcementId}/{attachmentId}/download", rs.downloadAnnouncementAttachment)
		r.With(admin, withTx).Delete("/{announcementId}/{attachmentId}", rs.deleteAnnouncementAttachment)
	})
	return r
}

// GuardianAttachments is the parents portal's attachment entry as these
// handlers consume it: it decides whether the guardian account is in the
// announcement's audience and reads the attachments through File Storage.
// The root binds the Parent Portal workflow; File Storage itself decides no
// audience (#4825).
type GuardianAttachments interface {
	// ListGuardianAttachments returns the attachments a guardian account may
	// see, or ErrAttachmentNotFound when it is outside the audience.
	ListGuardianAttachments(ctx context.Context, accountID, announcementID int64) ([]filestorage.Attachment, error)
	OpenGuardianAttachment(ctx context.Context, accountID, announcementID, attachmentID int64) (filestorage.Content, error)
	// OpenGuardianDeclarationProofAttachment opens an attachment frozen in the
	// caller's own declaration proof, including after the announcement expired
	// or was withdrawn.
	OpenGuardianDeclarationProofAttachment(ctx context.Context, accountID, announcementID, studentID, attachmentID int64) (filestorage.Content, error)
}

// parentAttachmentRoutes serves the guardian side through its entry.
type parentAttachmentRoutes struct {
	rs       *Resource
	guardian GuardianAttachments
}

// ParentAnnouncementAttachmentRouter serves the guardian side. It is mounted
// at the root rather than under /parent, which is a catch-all mount, and is
// authenticated with ParentScopeMiddleware. No tenant transaction: a parent token
// is cross-tenant, so the entry resolves the school from the announcement.
func (rs *Resource) ParentAnnouncementAttachmentRouter(protectedParentGroup func(chi.Router, func(chi.Router)), guardian GuardianAttachments) chi.Router {
	if guardian == nil {
		panic("files HTTP: guardian attachment entry is required")
	}
	routes := parentAttachmentRoutes{rs: rs, guardian: guardian}
	r := chi.NewRouter()
	protectedParentGroup(r, func(r chi.Router) {
		r.Get("/{announcementId}", routes.listParentAnnouncementAttachments)
		r.Get("/{announcementId}/{attachmentId}/download", routes.downloadParentAnnouncementAttachment)
	})
	return r
}

// renderAttachmentError maps the attachment errors onto HTTP.
func renderAttachmentError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, filestorage.ErrAttachmentNotFound):
		common.RenderError(w, r, common.ErrorNotFound(err))
	case errors.Is(err, filestorage.ErrAttachmentPublished):
		common.RenderError(w, r, common.ErrorConflictWithCode(errAnnouncementPublished, common.CodeFilesAnnouncementPublished))
	case errors.Is(err, filestorage.ErrAttachmentLimitReached):
		common.RenderError(w, r, common.ErrorConflictWithCode(errAttachmentLimit, common.CodeFilesAttachmentLimitReached))
	case errors.Is(err, filestorage.ErrObjectNotFound):
		common.RenderError(w, r, common.ErrorNotFound(errors.New("attachment not found")))
	default:
		renderError(w, r, err)
	}
}

// --- staff handlers -----------------------------------------------------------

func (rs *Resource) listAnnouncementAttachments(w http.ResponseWriter, r *http.Request) {
	announcementID, ok := common.ParseInt64IDWithError(w, r, "announcementId", "invalid announcement ID")
	if !ok {
		return
	}
	list, err := rs.files.ListAttachments(r.Context(), announcementID)
	if err != nil {
		renderAttachmentError(w, r, err)
		return
	}
	resp := StaffAttachmentListResponse{AnnouncementAttachmentListResponse: *newAttachmentListResponse(list.Attachments, list.Editable), AnnouncementVersion: list.Version}
	common.Respond(w, r, http.StatusOK, &resp, "Attachments retrieved successfully")
}

func (rs *Resource) uploadAnnouncementAttachment(w http.ResponseWriter, r *http.Request) {
	announcementID, ok := common.ParseInt64IDWithError(w, r, "announcementId", "invalid announcement ID")
	if !ok {
		return
	}
	actor, err := actorFromRequest(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorUnauthorized(err))
		return
	}
	upload, closeUpload, err := parseUpload(w, r)
	if err != nil {
		common.RenderError(w, r, common.ErrorUpload(err, maxFile))
		return
	}
	defer closeUpload()

	// The version of the draft the editor holds rides in the query: the
	// body is the file. Without it the owner refuses the upload.
	expectedVersion := r.URL.Query().Get("expected_version")
	attachment, version, err := rs.files.UploadAttachment(r.Context(), announcementID, expectedVersion, upload, actor)
	if err != nil {
		renderAttachmentError(w, r, err)
		return
	}
	resp := UploadedAttachmentResponse{AnnouncementAttachmentResponse: newAttachmentResponse(attachment), AnnouncementVersion: version}
	common.Respond(w, r, http.StatusCreated, &resp, "Attachment uploaded successfully")
}

func (rs *Resource) downloadAnnouncementAttachment(w http.ResponseWriter, r *http.Request) {
	announcementID, ok := common.ParseInt64IDWithError(w, r, "announcementId", "invalid announcement ID")
	if !ok {
		return
	}
	attachmentID, ok := common.ParseInt64IDWithError(w, r, "attachmentId", "invalid attachment ID")
	if !ok {
		return
	}
	content, err := rs.files.OpenAttachment(r.Context(), announcementID, attachmentID)
	if err != nil {
		renderAttachmentError(w, r, err)
		return
	}
	rs.serveContent(w, r, content)
}

func (rs *Resource) deleteAnnouncementAttachment(w http.ResponseWriter, r *http.Request) {
	announcementID, ok := common.ParseInt64IDWithError(w, r, "announcementId", "invalid announcement ID")
	if !ok {
		return
	}
	attachmentID, ok := common.ParseInt64IDWithError(w, r, "attachmentId", "invalid attachment ID")
	if !ok {
		return
	}
	actor, err := actorFromRequest(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorUnauthorized(err))
		return
	}
	// A DELETE without a body names no draft version; the owner refuses it.
	var req AttachmentRemovalRequest
	if err := common.DecodeReadStateBody(r, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	version, err := rs.files.DeleteAttachment(r.Context(), announcementID, attachmentID, req.ExpectedVersion, actor)
	if err != nil {
		renderAttachmentError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, AttachmentRemovedResponse{AnnouncementID: ident.ID(announcementID), AnnouncementVersion: version}, "Attachment deleted successfully")
}

// --- parent handlers ----------------------------------------------------------

// parentAccountID reads the guardian account from the parent token.
func parentAccountID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(errors.New("invalid token: no account id")))
		return 0, false
	}
	return int64(claims.ID), true
}

func (p parentAttachmentRoutes) listParentAnnouncementAttachments(w http.ResponseWriter, r *http.Request) {
	announcementID, ok := common.ParseInt64IDWithError(w, r, "announcementId", "invalid announcement ID")
	if !ok {
		return
	}
	accountID, ok := parentAccountID(w, r)
	if !ok {
		return
	}
	attachments, err := p.guardian.ListGuardianAttachments(r.Context(), accountID, announcementID)
	if err != nil {
		renderAttachmentError(w, r, err)
		return
	}
	// The parent side never edits attachments; the flag exists so both
	// responses share one shape.
	common.Respond(w, r, http.StatusOK, newAttachmentListResponse(attachments, false), "Attachments retrieved successfully")
}

func (p parentAttachmentRoutes) downloadParentAnnouncementAttachment(w http.ResponseWriter, r *http.Request) {
	announcementID, ok := common.ParseInt64IDWithError(w, r, "announcementId", "invalid announcement ID")
	if !ok {
		return
	}
	attachmentID, ok := common.ParseInt64IDWithError(w, r, "attachmentId", "invalid attachment ID")
	if !ok {
		return
	}
	accountID, ok := parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, hasProofStudentID := r.URL.Query()["student_id"]
	var content filestorage.Content
	var err error
	if hasProofStudentID {
		if len(studentID) != 1 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("student_id must be provided once")))
			return
		}
		parsedStudentID, parseErr := strconv.ParseInt(studentID[0], 10, 64)
		if parseErr != nil || parsedStudentID <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("student_id must be a positive integer")))
			return
		}
		content, err = p.guardian.OpenGuardianDeclarationProofAttachment(r.Context(), accountID, announcementID, parsedStudentID, attachmentID)
	} else {
		content, err = p.guardian.OpenGuardianAttachment(r.Context(), accountID, announcementID, attachmentID)
	}
	if err != nil {
		renderAttachmentError(w, r, err)
		return
	}
	p.rs.serveContent(w, r, content)
}
