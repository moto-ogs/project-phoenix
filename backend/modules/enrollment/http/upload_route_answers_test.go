package enrollmenthttp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

const uploadAnswerPhaseID int64 = 7

type uploadAnswerSchool struct{ id int64 }

func (s uploadAnswerSchool) GetSchoolBySlug(context.Context, string) (*PublicSchool, error) {
	return &PublicSchool{ID: s.id}, nil
}

type uploadAnswerIntake struct {
	UploadService
	t        *testing.T
	tenantID int64
}

func (s uploadAnswerIntake) CountUploadAttempt(_ context.Context, tenantID int64, _ string) error {
	require.Equal(s.t, s.tenantID, tenantID)
	return nil
}
func (s uploadAnswerIntake) PrepareUpload(_ context.Context, in capability.UploadInput) (*capability.PreparedUpload, error) {
	require.Equal(s.t, s.tenantID, in.TenantID)
	require.Equal(s.t, uploadAnswerPhaseID, in.PhaseID)
	return &capability.PreparedUpload{Token: "upload-token", Upload: &capability.RequestUpload{
		ID: 9, TenantID: in.TenantID, StoredName: "private.pdf", Filename: in.Filename, SizeBytes: in.SizeBytes, ContentType: in.ContentType,
	}}, nil
}

type uploadAnswerFiles struct {
	UploadFileStore
	content []byte
}

func (s *uploadAnswerFiles) Save(_ context.Context, _ int64, _ string, source io.Reader) (int64, error) {
	var err error
	s.content, err = io.ReadAll(source)
	return int64(len(s.content)), err
}

// Both public and authenticated forms use these owner handlers. The portal
// separately tests the school and audience facts it passes to ParentForms.
func TestEnrollmentUploadsAnswerWithTheStoredReceipt(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	for _, portal := range []string{"public", "parent"} {
		t.Run(portal, func(t *testing.T) {
			t.Parallel()
			files := &uploadAnswerFiles{}
			intake := uploadAnswerIntake{t: t, tenantID: testpkg.Tenant(t)}
			storage := func(string) (UploadFileStore, error) { return files, nil }
			router := chi.NewRouter()
			path := "/api/enrollment/testschule/uploads"
			if portal == "public" {
				resource := &Resource{SchoolService: uploadAnswerSchool{intake.tenantID}, Uploads: intake, UploadFiles: storage}
				router.Mount("/api/enrollment", resource.Router(func(chi.Router) {}))
			} else {
				forms := ParentForms{Uploads: intake, UploadFiles: storage}
				router.Post("/parent/enrollments/{tenantSlug}/uploads", func(w http.ResponseWriter, r *http.Request) {
					forms.StoreUpload(w, r, intake.tenantID, true, true)
				})
				path = "/parent/enrollments/testschule/uploads"
			}
			content := []byte("%PDF-1.4\nreceipt\n")
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			part, err := form.CreatePart(map[string][]string{
				"Content-Disposition": {`form-data; name="file"; filename="proof.pdf"`},
				"Content-Type":        {"application/pdf"},
			})
			require.NoError(t, err)
			_, err = part.Write(content)
			require.NoError(t, err)
			require.NoError(t, form.WriteField("phase_id", strconv.FormatInt(uploadAnswerPhaseID, 10)))
			require.NoError(t, form.WriteField("field_key", "proof"))
			require.NoError(t, form.Close())
			req := httptest.NewRequest(http.MethodPost, path, &body)
			req.Header.Set("Content-Type", form.FormDataContentType())
			req = req.WithContext(testpkg.WithTestTenantRuntime(t, req.Context()))
			rec := httptest.NewRecorder()
			testpkg.TenantRuntimeMiddleware(t, db)(router).ServeHTTP(rec, req)
			require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			var answer struct {
				Data UploadReceipt `json:"data"`
			}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &answer))
			require.Equal(t, UploadReceipt{Token: "upload-token", Filename: "proof.pdf", SizeBytes: int64(len(content)), ContentType: "application/pdf"}, answer.Data)
			require.Equal(t, content, files.content)
		})
	}
}
