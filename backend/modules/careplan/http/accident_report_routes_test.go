package careplanhttp_test

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type accidentReportAnswer struct {
	ID             testpkg.ID `json:"id"`
	StudentID      testpkg.ID `json:"student_id"`
	Category       string     `json:"category"`
	AccidentReport struct {
		Status       string  `json:"status"`
		SupersedesID *string `json:"supersedes_id"`
		InjuryKind   string  `json:"injury_kind"`
	} `json:"accident_report"`
}

// An accident report is recorded, changed, signed and corrected through the
// routes, and the open correction is deleted again; every answer shows what
// Care Plan stored (#4771).
func TestAccidentReportIsRecordedSignedCorrectedAndDeletedThroughTheRoutes(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock)
	store := testpkg.NewDatabase(t, tc.db)
	people := api.NewPeopleRepositorySuiteFactory(store)
	audit := owners.NewTestAuditPersistence(store, nil)
	caller := api.NewActiveTestCaller(store, testpkg.TenantRuntime(t, tc.db))
	records := newStudentTestRepositories(store).CarePlan
	documents, err := api.NewStudentDocumentsTestModule(store, records, people.Student, caller, audit.StudentFieldEdit, audit.DataAccessLog, fixedCalendarClock)
	require.NoError(t, err)
	reports, err := api.NewStudentAccidentReportsTestModule(store, records, people.Student, caller, audit.StudentFieldEdit, audit.DataAccessLog, fixedCalendarClock)
	require.NoError(t, err)
	tc.resource.StudentDocumentService = documents
	tc.resource.StudentAccidentReports = reports
	uploadFiles, err := nativeUploads.NewUploadFiles(nativeUploads.NewLocal(t.TempDir()))
	require.NoError(t, err)
	tc.resource.DocumentStorage = api.NewStudentDocumentStorage(api.TestUploadFileKeys(), uploadFiles)
	child := testpkg.CreateTestStudent(t, tc.db, "Unfall", "Kind", "U1")
	actor := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("accident-routes-%d@example.com", child.ID))
	claims := testutil.AdminTestClaims(int(actor.ID))
	perms := []string{"admin:*"}

	send := func(method, path string, body any, want int) accidentReportAnswer {
		t.Helper()
		rr := authExec(t, tc, testutil.NewAuthenticatedRequest(t, method, path, body), claims, perms)
		require.Equal(t, want, rr.Code, rr.Body.String())
		var answer struct {
			Data accidentReportAnswer `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &answer))
		return answer.Data
	}
	report := func(injury string) map[string]any {
		return map[string]any{
			"occurred_at": "2026-08-24T09:40:00+02:00", "location": "Schulhof, Klettergerüst",
			"description": "Beim Klettern abgerutscht.", "injured_body_parts": "Linker Unterarm", "injury_kind": injury,
			"witnesses": "Frau Berger", "first_aid": "Gekühlt", "doctor_visited": false,
			"parents_notified": "Mutter, telefonisch", "supervisor": "Frau Berger",
		}
	}
	base := fmt.Sprintf("/%d/accident-reports", child.ID)

	created := send(http.MethodPost, base, report("Prellung"), http.StatusCreated)
	assert.Equal(t, child.ID, created.StudentID)
	assert.Equal(t, "unfallanzeige", created.Category)
	assert.Equal(t, "open", created.AccidentReport.Status)

	// The paper copy is a scan: a Word document is refused before anything is
	// stored, as the upload form promises (PDF, PNG, JPEG).
	paper := authExec(t, tc, accidentPaperCopyRequest(t, fmt.Sprintf("%s/%d/paper-copy", base, created.ID)), claims, perms)
	require.Equal(t, http.StatusBadRequest, paper.Code, paper.Body.String())
	assert.Contains(t, paper.Body.String(), `"code":"files.file_type_not_allowed"`)

	updated := send(http.MethodPut, fmt.Sprintf("%s/%d", base, created.ID), report("Verstauchung"), http.StatusOK)
	assert.Equal(t, created.ID, updated.ID)
	assert.Equal(t, "Verstauchung", updated.AccidentReport.InjuryKind)

	signed := send(http.MethodPost, fmt.Sprintf("%s/%d/signature", base, created.ID),
		map[string]any{"method": "drawn", "image_png": accidentSignaturePNG(t)}, http.StatusOK)
	assert.Equal(t, "signed", signed.AccidentReport.Status)

	correction := send(http.MethodPost, fmt.Sprintf("%s/%d/corrections", base, created.ID), report("Prellung"), http.StatusCreated)
	require.NotNil(t, correction.AccidentReport.SupersedesID)
	assert.Equal(t, fmt.Sprint(created.ID), *correction.AccidentReport.SupersedesID)
	assert.Equal(t, "open", correction.AccidentReport.Status)

	rr := authExec(t, tc, testutil.NewRequest(http.MethodDelete, fmt.Sprintf("/%d/documents/%d", child.ID, correction.ID), nil), claims, perms)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var deleted struct {
		Data struct {
			StudentID testpkg.ID `json:"student_id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &deleted))
	assert.Equal(t, child.ID, deleted.Data.StudentID)
	var open int
	require.NoError(t, tc.db.NewSelect().TableExpr("users.student_documents").ColumnExpr("COUNT(*)").
		Where("student_id = ? AND deleted_at IS NULL", child.ID).Scan(testpkg.Ctx(t), &open))
	assert.Equal(t, 1, open, "the signed report stays, the open correction is gone")

	paperReport := send(http.MethodPost, base, report("Prellung"), http.StatusCreated)
	// A valid scan is stored and answers with the same report's document ID.
	var scan bytes.Buffer
	scanForm := multipart.NewWriter(&scan)
	scanPart, err := scanForm.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="Unfallanzeige.png"`},
		"Content-Type":        {"image/png"},
	})
	require.NoError(t, err)
	imageBytes, err := base64.StdEncoding.DecodeString(accidentSignaturePNG(t))
	require.NoError(t, err)
	_, err = scanPart.Write(imageBytes)
	require.NoError(t, err)
	require.NoError(t, scanForm.Close())
	scanRequest := testutil.NewRequest(http.MethodPost, fmt.Sprintf("%s/%d/paper-copy", base, paperReport.ID), &scan)
	scanRequest.Header.Set("Content-Type", scanForm.FormDataContentType())
	storedScan := authExec(t, tc, scanRequest, claims, perms)
	require.Equal(t, http.StatusCreated, storedScan.Code, storedScan.Body.String())
	var scanAnswer struct {
		Data struct {
			ID          testpkg.ID `json:"id"`
			Filename    string     `json:"filename"`
			ContentType string     `json:"content_type"`
			HasFile     bool       `json:"has_file"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(storedScan.Body.Bytes(), &scanAnswer))
	require.Equal(t, paperReport.ID, scanAnswer.Data.ID)

	require.Equal(t, "Unfallanzeige.png", scanAnswer.Data.Filename)
	require.Equal(t, "image/png", scanAnswer.Data.ContentType)
	require.True(t, scanAnswer.Data.HasFile)
}

// accidentPaperCopyRequest uploads a valid Word document as the paper copy.
func accidentPaperCopyRequest(t *testing.T, path string) *http.Request {
	t.Helper()
	var docx bytes.Buffer
	archive := zip.NewWriter(&docx)
	for _, name := range []string{"[Content_Types].xml", "word/document.xml"} {
		entry, err := archive.Create(name)
		require.NoError(t, err)
		_, err = entry.Write([]byte("<x/>"))
		require.NoError(t, err)
	}
	require.NoError(t, archive.Close())
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "Unfallanzeige.docx")
	require.NoError(t, err)
	_, err = part.Write(docx.Bytes())
	require.NoError(t, err)
	require.NoError(t, form.Close())
	req := testutil.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	return req
}

// accidentSignaturePNG is a small drawn signature: a dark diagonal.
func accidentSignaturePNG(t *testing.T) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 60, 20))
	for x := range 60 {
		img.SetNRGBA(x, x/3, color.NRGBA{R: 20, G: 30, B: 80, A: 255})
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}
