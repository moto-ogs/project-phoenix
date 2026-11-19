package enrollmenthttp_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	enrollment "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// Removing an unused legal document of the form at the production mount
// (#2352): the school's own PDF that no schema names is deleted from storage.
func TestDeleteLegalDocumentRoute_RemovesUnreferencedPDF(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	repos, err := api.NewEnrollmentTestRepositories(testpkg.NewDatabase(t, db), owners.NewTestAuditStore(testpkg.NewDatabase(t, db)))
	require.NoError(t, err)
	root := t.TempDir()
	files, err := objects.NewUploadFiles(objects.NewLocal(root))
	require.NoError(t, err)
	filename := fmt.Sprintf("%d_unused.pdf", tenantID)
	_, err = files.SaveNamed(strings.NewReader("%PDF-1.4\n%unused\n"), enrollment.EnrollmentFormLegalDocumentDir, filename, false)
	require.NoError(t, err)
	require.Equal(t, 1, storedFiles(t, root, filename), "the fixture PDF must exist before the delete")

	resource := enrollmentAPI.NewResource(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, files,
		enrollmentAPI.DatabaseFailures{Transient: transactionFailures.IsTransientDatabaseError, Constraint: transactionFailures.IsConstraintViolation}, time.Now, repos.Enrollment())
	router := testpkg.MountedQueryBudgetRouter("/api/enrollment", testpkg.TenantRuntimeMiddleware(t, db)(resource.Router(api.TenantSessionChain)))
	_, account := testpkg.CreateTestPersonWithAccount(t, db, "Lena", "Löscht")
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{
		ID: int(account.ID), Sub: account.Email, Username: account.Email,
		Roles: []string{"admin"}, Permissions: []string{"config:manage"}, TenantID: tenantID,
	})

	req := httptest.NewRequest(http.MethodDelete, "/legal-documents/"+filename, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Zero(t, storedFiles(t, root, filename), "the PDF is removed from storage")
}

// storedFiles counts the files of that name below the storage root.
func storedFiles(t *testing.T, root, name string) int {
	t.Helper()
	count := 0
	require.NoError(t, filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() && entry.Name() == name {
			count++
		}
		return err
	}))
	return count
}
