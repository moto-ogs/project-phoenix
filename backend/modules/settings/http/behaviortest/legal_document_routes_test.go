package settingshttp_test

import (
	"bytes"
	"encoding/json"
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
