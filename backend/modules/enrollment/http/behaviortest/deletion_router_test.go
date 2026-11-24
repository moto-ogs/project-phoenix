package enrollmenthttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	uploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	failures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The deletion of an enrollment at the production mount (#2352): the staff
// reads the mails to the family, removes one child with a reason, then the
// whole request.
func TestEnrollmentDeletionRoutes_DeleteChildThenRequest(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	f := newDeletionTestFixture(t, db, "router")
	resource := enrollmentHTTP.NewResource(nil, nil, nil, nil, nil, nil, nil, nil, nil, f.service(nil, nil), nil, nil, uploads.UploadFiles{}, enrollmentHTTP.DatabaseFailures{Transient: failures.IsTransientDatabaseError, Constraint: failures.IsConstraintViolation}, time.Now)
	router := testpkg.MountedQueryBudgetRouter("/api/enrollment", testpkg.TenantRuntimeMiddleware(t, db)(resource.Router(api.TenantSessionChain)))
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(f.actor), Sub: "deletion-router", Username: "deletion-router", TenantID: f.scope.TenantID, Roles: []string{"admin"}, Permissions: []string{"config:manage"}})
	request := f.request("router", nil)
	target := f.child(request.ID, "Removed", enrollmentNative.ChildStatusRejected, nil)
	remaining := f.child(request.ID, "Kept", enrollmentNative.ChildStatusRejected, nil)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	base := fmt.Sprintf("/admin/requests/%d", request.ID)

	mails := call(http.MethodGet, base+"/mails", "")
	require.Equal(t, http.StatusOK, mails.Code, mails.Body.String())
	var mailBody struct {
		Data []enrollmentNative.RequestMailOutcome `json:"data"`
	}
	require.NoError(t, json.Unmarshal(mails.Body.Bytes(), &mailBody))
	assert.NotNil(t, mailBody.Data, "the mails answer a list, also without mails")

	// Each deletion confirms the preview it read: its fingerprint (ADR 0311).
	preview := func(path string) string {
		rec := call(http.MethodGet, path+"/delete-impact", "")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var impact struct {
			Data enrollmentHTTP.AdminEnrollmentDeletionImpact `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &impact))
		require.NotEmpty(t, impact.Data.Fingerprint)
		return impact.Data.Fingerprint
	}
	confirm := func(reason, fingerprint string) string {
		return fmt.Sprintf(`{"reason":%q,"expected_fingerprint":%q}`, reason, fingerprint)
	}
	shownBeforeChild := preview(base)

	child := call(http.MethodDelete, fmt.Sprintf("%s/children/%d", base, target.ID), confirm("Doppelte Anmeldung", preview(fmt.Sprintf("%s/children/%d", base, target.ID))))
	require.Equal(t, http.StatusOK, child.Code, child.Body.String())
	var childImpact struct {
		Data enrollmentHTTP.AdminEnrollmentDeletionImpact `json:"data"`
	}
	require.NoError(t, json.Unmarshal(child.Body.Bytes(), &childImpact))
	assert.Equal(t, fmt.Sprint(target.ID), childImpact.Data.ChildID.String())
	assert.False(t, childImpact.Data.DeletesRequest)
	assert.Zero(t, tableCount(t, db, "enrollment.request_children", "id = ?", target.ID))
	assert.Equal(t, 1, tableCount(t, db, "enrollment.request_children", "id = ?", remaining.ID))

	// The preview read before the child went counts two children: refused.
	stale := call(http.MethodDelete, base+"/", confirm("Anmeldung zurückgezogen", shownBeforeChild))
	require.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	assert.Contains(t, stale.Body.String(), `"code":"general.changed_since_read"`)
	assert.Equal(t, 1, tableCount(t, db, "enrollment.requests", "id = ?", request.ID))

	whole := call(http.MethodDelete, base+"/", confirm("Anmeldung zurückgezogen", preview(base)))
	require.Equal(t, http.StatusOK, whole.Code, whole.Body.String())
	var requestImpact struct {
		Data enrollmentHTTP.AdminEnrollmentDeletionImpact `json:"data"`
	}
	require.NoError(t, json.Unmarshal(whole.Body.Bytes(), &requestImpact))
	assert.True(t, requestImpact.Data.DeletesRequest)
	assert.Equal(t, fmt.Sprint(request.ID), requestImpact.Data.RequestID.String())
	assert.Zero(t, tableCount(t, db, "enrollment.requests", "id = ?", request.ID))
	assert.Equal(t, 2, tableCount(t, db, "audit.enrollment_deletions", "tenant_id = ? AND request_id = ?", f.scope.TenantID, request.ID))
}
