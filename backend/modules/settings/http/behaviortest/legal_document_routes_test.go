package settingshttp_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	objects "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/modules/settings/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestLegalDocumentRoutesStoreAndClearTheDocumentTheyAnswer(t *testing.T) {
	t.Parallel()
	f := newSettingsBudgetFixture(t, testpkg.SetupTestDB(t))
	token := testutil.MintTestJWT(t, f.admin)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="document"; filename="terms.pdf"`},
		"Content-Type":        {"application/pdf"},
	})
	require.NoError(t, err)
	_, err = io.WriteString(part, "%PDF-1.4\nterms\n")
	require.NoError(t, err)
	require.NoError(t, form.Close())
	path := "/api/settings/enrollment/legal-agb-document"
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := testutil.ExecuteRequestForTest(t, f.router, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var answer struct {
		Data struct {
			DocumentURL string `json:"document_url"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &answer))
	require.NotEmpty(t, answer.Data.DocumentURL)
	stored, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), f.db, f.module.Settings.ResolveString, records.KeyEnrollmentLegalAGBDocumentURL)
	require.NoError(t, err)
	require.Equal(t, answer.Data.DocumentURL, stored)
	file, err := (objects.UploadFiles{}).StoredPath("public", stored, "/uploads/enrollment-legal-documents/")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.Remove(file) })
	req = httptest.NewRequest(http.MethodDelete, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = testutil.ExecuteRequestForTest(t, f.router, req)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	require.Empty(t, rec.Body.String())
	stored, err = testpkg.TenantQuery1(t, testpkg.Ctx(t), f.db, f.module.Settings.ResolveString, records.KeyEnrollmentLegalAGBDocumentURL)
	require.NoError(t, err)
	require.Empty(t, stored)
}

// The login image and the value reset are served by the staff portal's own
// route files (#7808); their answers keep the registered contract.
func TestLoginImageRoutesStoreAnswerAndClearTheImage(t *testing.T) {
	t.Parallel()
	f := newSettingsBudgetFixture(t, testpkg.SetupTestDB(t))
	token := testutil.MintTestJWT(t, f.admin)
	send := func(method, path string, body io.Reader, contentType string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, body)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		return testutil.ExecuteRequestForTest(t, f.router, req)
	}
	var pixel bytes.Buffer
	require.NoError(t, png.Encode(&pixel, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="login_image"; filename="login.png"`},
		"Content-Type":        {"image/png"},
	})
	require.NoError(t, err)
	_, err = part.Write(pixel.Bytes())
	require.NoError(t, err)
	require.NoError(t, form.Close())

	rec := send(http.MethodPost, "/api/settings/login-image", &body, form.FormDataContentType())
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var uploaded struct {
		Data struct {
			LoginImageURL string `json:"login_image_url"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &uploaded))
	require.NotEmpty(t, uploaded.Data.LoginImageURL)
	file, err := (objects.UploadFiles{}).StoredPath("public", uploaded.Data.LoginImageURL, "/uploads/login-images/")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.Remove(file) })

	rec = send(http.MethodGet, "/api/settings/login-image", nil, "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), uploaded.Data.LoginImageURL)

	rec = send(http.MethodDelete, "/api/settings/login-image", nil, "")
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())

	rec = send(http.MethodDelete, "/api/settings/values/operations.student_daily_checkout_time", nil, "")
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
}
