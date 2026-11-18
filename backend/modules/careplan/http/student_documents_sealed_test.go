package careplanhttp_test

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestStudentDocumentsSealHealthCategories: an Attest lies sealed on disk and
// downloads as uploaded; a Betreuungsvertrag stays unsealed (#3840).
func TestStudentDocumentsSealHealthCategories(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t, fixedCalendarClock)
	store := testpkg.NewDatabase(t, tc.db)
	people := api.NewPeopleRepositorySuiteFactory(store)
	audit := owners.NewTestAuditPersistence(store, nil)
	caller := api.NewActiveTestCaller(store, testpkg.TenantRuntime(t, tc.db))
	documents, err := api.NewStudentDocumentsTestModule(store, newStudentTestRepositories(store).CarePlan, people.Student, caller, audit.StudentFieldEdit, audit.DataAccessLog, fixedCalendarClock)
	require.NoError(t, err)
	tc.resource.StudentDocumentService = documents
	tc.resource.DocumentStorage = api.NewStudentDocumentStorage(api.TestUploadFileKeys())
	child := testpkg.CreateTestStudent(t, tc.db, "Sealed", "Attest", "S20")
	actor := testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("sealed-attest-%d@example.com", child.ID))
	publicDir, err := nativeUploads.ResolvePublicDir()
	require.NoError(t, err)
	dir := filepath.Join(publicDir, "uploads", "student-documents", strconv.FormatInt(testpkg.Tenant(t), 10))
	pdf := []byte("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")

	upload := func(category string) (int64, []byte) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("category", category))
		part, err := writer.CreateFormFile("file", category+".pdf")
		require.NoError(t, err)
		_, err = part.Write(pdf)
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		req := testutil.NewRequest(http.MethodPost, fmt.Sprintf("/%d/documents", child.ID), &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rr := students20Exec(t, tc, req, testutil.AdminTestClaims(int(actor.ID)), []string{"admin:*"})
		require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
		var id, size int64
		var name string
		require.NoError(t, tc.db.NewRaw("SELECT id, filename_stored, size_bytes FROM users.student_documents WHERE student_id = ? AND category = ?", child.ID, category).
			Scan(testpkg.Ctx(t), &id, &name, &size))
		assert.Equal(t, int64(len(pdf)), size)
		t.Cleanup(func() { _ = os.Remove(filepath.Join(dir, name)) })
		onDisk, err := os.ReadFile(filepath.Join(dir, name))
		require.NoError(t, err)
		return id, onDisk
	}
	attest, attestOnDisk := upload("attest")
	assert.True(t, bytes.HasPrefix(attestOnDisk, []byte("MOTOSEAL")), "the Attest lies sealed")
	assert.False(t, bytes.Contains(attestOnDisk, pdf[:8]))
	contract, contractOnDisk := upload("betreuungsvertrag")
	assert.Equal(t, pdf, contractOnDisk, "other categories stay unsealed")

	for _, id := range []int64{attest, contract} {
		rr := students20Exec(t, tc, testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/documents/%d/download", child.ID, id), nil), testutil.AdminTestClaims(int(actor.ID)), []string{"admin:*"})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assert.Equal(t, pdf, rr.Body.Bytes())
	}
	denied := students20Exec(t, tc, testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/documents/%d/download", child.ID, attest), nil), testutil.AdminTestClaims(int(actor.ID)), []string{"users:read", "users:update"})
	assert.Equal(t, http.StatusForbidden, denied.Code, "without student_documents:health the Attest stays closed")
}
