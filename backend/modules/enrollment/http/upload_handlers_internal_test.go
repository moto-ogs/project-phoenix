package enrollmenthttp

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

type uploadOpenStub struct {
	upload *capability.RequestUpload
}

func (s uploadOpenStub) CountUploadAttempt(context.Context, int64, string) error {
	return errors.New("not implemented")
}

func (s uploadOpenStub) PrepareUpload(context.Context, capability.UploadInput) (*capability.PreparedUpload, error) {
	return nil, errors.New("not implemented")
}

func (s uploadOpenStub) DiscardUpload(context.Context, int64, int64) error {
	return errors.New("not implemented")
}

func (s uploadOpenStub) OpenRequestUpload(context.Context, capability.UploadAccess) (*capability.RequestUpload, error) {
	return s.upload, nil
}

func TestExtensionMatchesContent(t *testing.T) {
	t.Parallel()

	assert.True(t, extensionMatchesContent("Bescheid.PDF", "application/pdf"))
	assert.True(t, extensionMatchesContent("foto.jpeg", "image/jpeg"))
	assert.True(t, extensionMatchesContent("IMG_0001.jpg", "image/jpeg"))
	assert.True(t, extensionMatchesContent("scan.png", "image/png"))
	assert.False(t, extensionMatchesContent("bescheid.png", "application/pdf"), "a renamed PDF is refused")
	assert.False(t, extensionMatchesContent("bescheid", "application/pdf"), "a file without extension is refused")
	assert.False(t, extensionMatchesContent("brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
}

func TestOpenAdminRequestUpload_StorageFactoryFailureIsServerError(t *testing.T) {
	t.Parallel()

	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("id", "12")
	routeCtx.URLParams.Add("uploadId", "34")
	req := httptest.NewRequest(http.MethodGet, "/admin/requests/12/uploads/34", nil)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	w := httptest.NewRecorder()
	resource := &Resource{
		Now: resourceTestClock,
		Uploads: uploadOpenStub{upload: &capability.RequestUpload{
			ID: 34, TenantID: 56, StoredName: "proof.pdf", Filename: "Nachweis.pdf", ContentType: "application/pdf",
		}},
		UploadFiles: func(string) (UploadFileStore, error) { return nil, errors.New("object store unavailable") },
	}

	resource.openAdminRequestUpload(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Contains(t, w.Body.String(), `"code":"general.server"`)
}

// The uploads read their one file and named text parts only; a body with
// any other part is refused before the file is stored (#2352), as the
// frontend server forwarded no other part before.
func TestUploadsReadOnlyTheirOwnParts(t *testing.T) {
	t.Parallel()
	pdf := []byte("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
	type part struct{ name, filename string }
	body := func(parts ...part) *http.Request {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		for _, p := range parts {
			if p.filename != "" {
				fw, err := writer.CreateFormFile(p.name, p.filename)
				require.NoError(t, err)
				_, err = fw.Write(pdf)
				require.NoError(t, err)
				continue
			}
			require.NoError(t, writer.WriteField(p.name, "7"))
		}
		require.NoError(t, writer.Close())
		req := httptest.NewRequest(http.MethodPost, "/uploads", &buf)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		return req
	}
	file := part{"file", "nachweis.pdf"}

	t.Run("enrollment", func(t *testing.T) {
		t.Parallel()
		accepted, input, err := parseEnrollmentUpload(httptest.NewRecorder(),
			body(file, part{"phase_id", ""}, part{"field_key", ""}, part{"late_invite_token", ""}, part{"status_token", ""}))
		require.NoError(t, err)
		require.NoError(t, accepted.File.Close())
		assert.Equal(t, int64(7), input.PhaseID)

		for name, parts := range map[string][]part{
			"an unknown text part":  {file, part{"phase_id", ""}, part{"tenant_id", ""}},
			"a second file":         {file, part{"phase_id", ""}, part{"file", "zweite.pdf"}},
			"a file in a text part": {file, part{"phase_id", ""}, part{"field_key", "feld.pdf"}},
			"a repeated text part":  {file, part{"phase_id", ""}, part{"phase_id", ""}},
		} {
			_, _, err := parseEnrollmentUpload(httptest.NewRecorder(), body(parts...))
			var unexpected *unexpectedFormPart
			assert.ErrorAs(t, err, &unexpected, name)
			rec := httptest.NewRecorder()
			renderUploadRefusal(rec, httptest.NewRequest(http.MethodPost, "/uploads", nil), err)
			assert.Equal(t, http.StatusBadRequest, rec.Code, name)
			assert.NotContains(t, rec.Body.String(), "enrollment.upload_invalid", name)
		}
	})

	t.Run("holiday proof", func(t *testing.T) {
		t.Parallel()
		_, err := parseHolidayProof(httptest.NewRecorder(), body(file))
		require.NoError(t, err)
		_, err = parseHolidayProof(httptest.NewRecorder(), body(file, part{"phase_id", ""}))
		var unexpected *unexpectedFormPart
		assert.ErrorAs(t, err, &unexpected)
	})
}
