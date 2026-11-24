// Router-level tests for the attachments of an Elternmitteilung (#2890):
// upload, list, download and delete on a draft, the refusal to change a
// published announcement, the file-type gate, and the cleanup intent that
// keeps the bytes reachable after the row is soft-deleted.
package files_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	filestorageModule "github.com/moto-ogs/project-phoenix/modules/filestorage"
	filestoreAPI "github.com/moto-ogs/project-phoenix/modules/filestorage/http/files"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// attachmentContext extends the file-storage harness with the attachment
// router and an announcement to hang files off.
type attachmentContext struct {
	*apiContext
	announcementID int64
}

func setupAttachmentRoute(t *testing.T) *attachmentContext {
	t.Helper()
	c := setupFileStoreRoute(t)
	c.router.Mount("/announcement-attachments", filestoreAPI.NewResource(c.files, slog.Default()).AnnouncementAttachmentRouter(rootAPI.ProtectedTenantRoutes))
	t.Cleanup(func() {
		if pubDir, err := nativeUploads.ResolvePublicDir(); err == nil {
			_ = os.RemoveAll(filepath.Join(pubDir, "uploads", "announcement-attachments",
				fmt.Sprint(testpkg.Tenant(t))))
		}
	})
	announcement := testpkg.CreateTestParentAnnouncement(t, c.db, c.admin, "Ausflug")
	return &attachmentContext{apiContext: c, announcementID: announcement.ID}
}

// draftVersion is the version of the draft as its editor reads it: the
// token every attachment change sends (ADR 0311).
func draftVersion(t *testing.T, db bun.IDB, announcementID int64) string {
	t.Helper()
	var updatedAt time.Time
	require.NoError(t, db.NewRaw(`SELECT updated_at FROM users.parent_announcements WHERE id = ?`, announcementID).Scan(testpkg.Ctx(t), &updatedAt))
	return readstate.Of(updatedAt)
}

func (c *attachmentContext) uploadAttachment(filename string, content []byte) *httptest.ResponseRecorder {
	return c.uploadAttachmentAt(draftVersion(c.t, c.db, c.announcementID), filename, content)
}

// uploadAttachmentAt uploads onto the draft of the given version.
func (c *attachmentContext) uploadAttachmentAt(version, filename string, content []byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filename)
	require.NoError(c.t, err)
	_, err = part.Write(content)
	require.NoError(c.t, err)
	require.NoError(c.t, writer.Close())
	return c.do(http.MethodPost,
		fmt.Sprintf("/announcement-attachments/%d?expected_version=%s", c.announcementID, url.QueryEscape(version)),
		&buf, writer.FormDataContentType(), c.admin, permissions.AdminWildcard)
}

func (c *attachmentContext) deleteAttachment(attachmentID string) *httptest.ResponseRecorder {
	return c.deleteAttachmentAt(draftVersion(c.t, c.db, c.announcementID), attachmentID)
}

// deleteAttachmentAt removes an attachment from the draft of the given
// version.
func (c *attachmentContext) deleteAttachmentAt(version, attachmentID string) *httptest.ResponseRecorder {
	body, err := json.Marshal(map[string]string{"expected_version": version})
	require.NoError(c.t, err)
	return c.do(http.MethodDelete,
		fmt.Sprintf("/announcement-attachments/%d/%s", c.announcementID, attachmentID),
		bytes.NewReader(body), "application/json", c.admin, permissions.AdminWildcard)
}

func (c *attachmentContext) listAttachments() (*httptest.ResponseRecorder, attachmentListBody) {
	rec := c.do(http.MethodGet,
		fmt.Sprintf("/announcement-attachments/%d", c.announcementID),
		nil, "", c.admin, permissions.AdminWildcard)
	var envelope struct {
		Data attachmentListBody `json:"data"`
	}
	if rec.Code == http.StatusOK {
		require.NoError(c.t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	}
	return rec, envelope.Data
}

type attachmentListBody struct {
	Attachments []struct {
		ID          string `json:"id"`
		Filename    string `json:"filename"`
		SizeBytes   int64  `json:"size_bytes"`
		ContentType string `json:"content_type"`
	} `json:"attachments"`
	MaxCount int   `json:"max_count"`
	MaxBytes int64 `json:"max_bytes"`
	Editable bool  `json:"editable"`
}

func TestAnnouncementAttachmentLifecycle(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)

	rec := c.uploadAttachment("Einverständnis.pdf", fakePDF)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	listRec, list := c.listAttachments()
	require.Equal(t, http.StatusOK, listRec.Code)
	require.Len(t, list.Attachments, 1)
	assert.Equal(t, "Einverständnis.pdf", list.Attachments[0].Filename,
		"the name the school typed is what the parents see")
	assert.Equal(t, "application/pdf", list.Attachments[0].ContentType)
	assert.True(t, list.Editable, "a draft's attachments can still be changed")
	// The limits travel with the list so the form can state them before
	// somebody picks a file.
	assert.Positive(t, list.MaxCount)
	assert.Positive(t, list.MaxBytes)

	attachmentID := list.Attachments[0].ID

	// The download carries the display name and is served as an attachment.
	dlRec := c.do(http.MethodGet,
		fmt.Sprintf("/announcement-attachments/%d/%s/download", c.announcementID, attachmentID),
		nil, "", c.admin, permissions.AdminWildcard)
	require.Equal(t, http.StatusOK, dlRec.Code)
	assert.Equal(t, fakePDF, dlRec.Body.Bytes())
	assert.Contains(t, dlRec.Header().Get("Content-Disposition"), "attachment")
	assert.Equal(t, "nosniff", dlRec.Header().Get("X-Content-Type-Options"))

	delRec := c.deleteAttachment(attachmentID)
	require.Equal(t, http.StatusOK, delRec.Code, delRec.Body.String())

	_, afterDelete := c.listAttachments()
	assert.Empty(t, afterDelete.Attachments, "a deleted attachment leaves the list")
}

func TestAnnouncementAttachmentRejectsUnknownFileType(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)

	// An executable renamed to .pdf must not pass: the gate reads the magic
	// bytes, not the extension.
	rec := c.uploadAttachment("harmlos.pdf", []byte("MZ\x90\x00 this is not a pdf"))
	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "nicht erlaubt",
		"the rejection reaches the school in German, naming the allowed formats")

	// A bare ZIP is refused too — the OOXML parts are what prove a DOCX.
	rec = c.uploadAttachment("liste.xlsx", []byte("PK\x03\x04 not really an office file"))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestAnnouncementAttachmentPublishedAnnouncementIsFixed(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)

	// One file goes on while it is still a draft.
	require.Equal(t, http.StatusCreated, c.uploadAttachment("Brief.pdf", fakePDF).Code)
	_, before := c.listAttachments()
	require.Len(t, before.Attachments, 1)

	testpkg.PublishTestParentAnnouncement(t, c.db, c.announcementID)

	// After publication the attachments are part of what the parents were
	// shown — and, for an Elternbrief, of what they confirmed. Neither adding
	// nor removing one may still happen; the correction path is zurückziehen,
	// ändern, erneut veröffentlichen.
	rec := c.uploadAttachment("Nachtrag.pdf", fakePDF)
	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "zurück",
		"the message says what to do, not just that it failed")

	delRec := c.deleteAttachment(before.Attachments[0].ID)
	assert.Equal(t, http.StatusConflict, delRec.Code)

	// The file itself stays readable — immutability is not invisibility.
	listRec, after := c.listAttachments()
	require.Equal(t, http.StatusOK, listRec.Code)
	require.Len(t, after.Attachments, 1)
	assert.False(t, after.Editable, "the UI must be able to say the file is fixed now")
}

func TestAnnouncementAttachmentLimitKeepsDraftEditable(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)

	// Die Höchstzahl steht in der Liste — dieselbe Zahl, die auch der
	// Assistent anzeigt, statt einer zweiten Quelle im Test.
	_, empty := c.listAttachments()
	maxCount := empty.MaxCount
	require.Positive(t, maxCount)

	for i := range maxCount {
		rec := c.uploadAttachment(fmt.Sprintf("Anlage-%d.pdf", i+1), fakePDF)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	}

	// Die Höchstzahl ist erreicht: eine weitere Datei passt nicht mehr dazu.
	assert.Equal(t, http.StatusConflict, c.uploadAttachment("Zuviel.pdf", fakePDF).Code)

	// Änderbar bleibt der Entwurf trotzdem. Sagt die Liste hier editable:
	// false, blendet die Oberfläche auch das Entfernen aus — und damit den
	// einzigen Weg, wieder Platz zu schaffen.
	listRec, list := c.listAttachments()
	require.Equal(t, http.StatusOK, listRec.Code)
	require.Len(t, list.Attachments, maxCount)
	assert.True(t, list.Editable,
		"an der Höchstzahl darf nur das Hinzufügen enden, nicht das Entfernen")

	delRec := c.deleteAttachment(list.Attachments[0].ID)
	require.Equal(t, http.StatusOK, delRec.Code, delRec.Body.String())

	// Und danach geht wieder eine dazu.
	assert.Equal(t, http.StatusCreated, c.uploadAttachment("Ersatz.pdf", fakePDF).Code)
}

func TestAnnouncementAttachmentUnknownAnnouncementIsNotFound(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)

	rec := c.do(http.MethodGet,
		fmt.Sprintf("/announcement-attachments/%d", c.announcementID+9_000_000),
		nil, "", c.admin, permissions.AdminWildcard)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestAnnouncementAttachmentRequiresAdmin(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)

	// Who may not write an Elternmitteilung may not attach a file to one.
	rec := c.do(http.MethodGet,
		fmt.Sprintf("/announcement-attachments/%d", c.announcementID),
		nil, "", c.member, "students:read")
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

// The guardian entry of the parents portal decides the audience and then
// reads through these tenant-scoped reads (#4825); they serve exactly the
// named school's rows.
func TestAnnouncementAttachmentTenantReadsServeOnlyTheNamedSchool(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)
	rec := c.uploadAttachment("Einverständnis.pdf", fakePDF)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	ctx := testpkg.WithTestTenantRuntime(t, context.Background())
	tenantID := testpkg.Tenant(t)
	reads, err := filestorageModule.TenantReads(c.files)
	require.NoError(t, err)

	attachments, err := reads.ListAnnouncementAttachmentsInTenant(ctx, tenantID, c.announcementID)
	require.NoError(t, err)
	require.Len(t, attachments, 1)
	attachmentID := attachments[0].ID
	found, err := reads.FindAnnouncementAttachmentInTenant(ctx, tenantID, c.announcementID, attachmentID)
	require.NoError(t, err)
	assert.Equal(t, "Einverständnis.pdf", found.Filename)
	content, err := reads.OpenAnnouncementAttachmentInTenant(ctx, tenantID, c.announcementID, attachmentID)
	require.NoError(t, err)
	t.Cleanup(func() { _ = content.Close() })
	body, err := io.ReadAll(io.NewSectionReader(content.Object, 0, content.Object.Size()))
	require.NoError(t, err)
	assert.Equal(t, fakePDF, body)

	otherTenant, _ := testpkg.CreateTestTenant(t, c.db)
	other, err := reads.ListAnnouncementAttachmentsInTenant(ctx, otherTenant, c.announcementID)
	require.NoError(t, err)
	assert.Empty(t, other, "another school's RLS hides the rows")
	_, err = reads.FindAnnouncementAttachmentInTenant(ctx, otherTenant, c.announcementID, attachmentID)
	require.ErrorIs(t, err, filestorageModule.ErrAttachmentNotFound)
	_, err = reads.OpenAnnouncementAttachmentInTenant(ctx, otherTenant, c.announcementID, attachmentID)
	require.ErrorIs(t, err, filestorageModule.ErrAttachmentNotFound)
	_, err = reads.OpenAnnouncementAttachmentInTenant(ctx, 0, c.announcementID, attachmentID)
	require.ErrorIs(t, err, filestorageModule.ErrAttachmentNotFound)
}

// The attachments are part of what a publication confirms (ADR 0311): each
// change carries the version of the draft its editor holds, is refused on a
// draft changed since and then writes nothing, and answers the version it
// stamped, which the next change and the publication send.
func TestAnnouncementAttachmentChangesCarryTheDraftVersion(t *testing.T) {
	t.Parallel()
	c := setupAttachmentRoute(t)
	opened := draftVersion(t, c.db, c.announcementID)

	rec := c.uploadAttachmentAt(opened, "Brief.pdf", fakePDF)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var uploaded struct {
		Data struct {
			ID                  string `json:"id"`
			AnnouncementVersion string `json:"announcement_version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &uploaded))
	afterUpload := draftVersion(t, c.db, c.announcementID)
	assert.NotEqual(t, opened, afterUpload, "the upload stamps the draft: a publication of the older version is refused")
	assert.Equal(t, afterUpload, uploaded.Data.AnnouncementVersion, "the upload answers the version it stamped")

	// A colleague's editor still holds the version before the upload.
	stale := c.uploadAttachmentAt(opened, "Nachtrag.pdf", fakePDF)
	assert.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	assert.Contains(t, stale.Body.String(), "general.changed_since_read")
	staleDelete := c.deleteAttachmentAt(opened, uploaded.Data.ID)
	assert.Equal(t, http.StatusConflict, staleDelete.Code, staleDelete.Body.String())
	assert.Contains(t, staleDelete.Body.String(), "general.changed_since_read")
	_, list := c.listAttachments()
	require.Len(t, list.Attachments, 1, "the refused changes wrote nothing")
	assert.Equal(t, afterUpload, draftVersion(t, c.db, c.announcementID), "the refused changes stamped nothing")

	removed := c.deleteAttachmentAt(uploaded.Data.AnnouncementVersion, uploaded.Data.ID)
	require.Equal(t, http.StatusOK, removed.Code, removed.Body.String())
	var removal struct {
		Data struct {
			AnnouncementVersion string `json:"announcement_version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(removed.Body.Bytes(), &removal))
	afterDelete := draftVersion(t, c.db, c.announcementID)
	assert.NotEqual(t, afterUpload, afterDelete, "the removal stamps the draft too")
	assert.Equal(t, afterDelete, removal.Data.AnnouncementVersion)
}
