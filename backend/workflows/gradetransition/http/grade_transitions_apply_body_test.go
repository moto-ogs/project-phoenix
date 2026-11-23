// Apply-body handling for the grade-transition apply endpoint (#405 review).
//
// The apply confirms a preview: an absent or empty body names none and is
// refused like a stale one (ADR 0311), so the destructive transition never
// runs on a cohort nobody confirmed. A MALFORMED body is rejected as such
// instead of being read as an empty one.
package gradetransitionhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rootAPI "github.com/moto-ogs/project-phoenix/api"

	"github.com/go-chi/chi/v5"
	"github.com/gofrs/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestGradeTransitionResource_Apply_BodyHandling(t *testing.T) {
	t.Parallel()
	tc := setupGradeTransitionsModule(t)

	account := testpkg.CreateTestAccount(t, tc.db, "apply-body-test@example.com")

	router := tc.resource.Router(rootAPI.ProtectedTenantRoutes)
	token := mintAdminToken(t, account.ID)

	// newApplyRequest posts a RAW body so a deliberately broken payload survives
	// to the handler (the shared helper marshals its argument and would reject
	// invalid JSON in the test itself).
	newApplyRequest := func(transitionID int64, rawBody string) *http.Request {
		url := fmt.Sprintf("/%d/apply", transitionID)
		var req *http.Request
		if rawBody == "" {
			req = httptest.NewRequest(http.MethodPost, url, nil)
		} else {
			req = httptest.NewRequest(http.MethodPost, url, strings.NewReader(rawBody))
		}
		req.Header.Set("Content-Type", "application/json")
		testutil.WithJWTBearer(token)(req)
		return req
	}

	newTransition := func(t *testing.T) int64 {
		t.Helper()
		suffix := uuid.Must(uuid.NewV4()).String()[:8]
		fromClass := fmt.Sprintf("1body-%s", suffix)
		toClass := fmt.Sprintf("2body-%s", suffix)

		_ = testpkg.CreateTestStudent(t, tc.db, "ApplyBody", "Test", fromClass)

		transition := testpkg.CreateTestGradeTransition(t, tc.db, "2025-2026", account.ID)
		testpkg.CreateTestGradeTransitionMapping(t, tc.db, transition.ID, fromClass, &toClass)
		return transition.ID
	}

	t.Run("truncated JSON body is rejected and the transition stays applicable", func(t *testing.T) {
		transitionID := newTransition(t)

		rr := testutil.ExecuteRequest(router, newApplyRequest(transitionID, `{"expected_fingerprint": `))
		require.Equal(t, http.StatusBadRequest, rr.Code, "malformed body must not apply the transition")

		// Still in draft: nothing was applied behind the broken request.
		var status string
		require.NoError(t, tc.db.NewSelect().
			TableExpr("education.grade_transitions").
			Column("status").
			Where("id = ?", transitionID).
			Scan(testpkg.Ctx(t), &status))
		assert.Equal(t, schoolstructure.TransitionStatusDraft, status)
	})

	t.Run("wrong-typed fingerprint field is rejected", func(t *testing.T) {
		transitionID := newTransition(t)

		rr := testutil.ExecuteRequest(router, newApplyRequest(transitionID, `{"expected_fingerprint": 42}`))
		assert.Equal(t, http.StatusBadRequest, rr.Code)
	})

	draft := func(t *testing.T, transitionID int64) string {
		t.Helper()
		var status string
		require.NoError(t, tc.db.NewSelect().
			TableExpr("education.grade_transitions").
			Column("status").
			Where("id = ?", transitionID).
			Scan(testpkg.Ctx(t), &status))
		return status
	}

	for name, body := range map[string]string{"empty body": "", "empty JSON object": `{}`} {
		t.Run(name+" confirms no preview and applies nothing", func(t *testing.T) {
			transitionID := newTransition(t)

			rr := testutil.ExecuteRequest(router, newApplyRequest(transitionID, body))
			require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
			assert.Contains(t, rr.Body.String(), `"code":"grade_transition.preview_stale"`)
			assert.Equal(t, schoolstructure.TransitionStatusDraft, draft(t, transitionID))
		})
	}

	t.Run("the previewed fingerprint applies", func(t *testing.T) {
		transitionID := newTransition(t)

		confirmed, err := json.Marshal(previewedApply(t, router, token, transitionID))
		require.NoError(t, err)
		rr := testutil.ExecuteRequest(router, newApplyRequest(transitionID, string(confirmed)))
		testutil.AssertSuccessResponse(t, rr, http.StatusOK)
		assert.Equal(t, schoolstructure.TransitionStatusApplied, draft(t, transitionID))
	})
}

// previewedApply is the apply body of an admin who confirmed the preview: the
// fingerprint the preview route answered (ADR 0311).
func previewedApply(t *testing.T, router chi.Router, token string, transitionID int64) map[string]string {
	t.Helper()
	rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, "GET", fmt.Sprintf("/%d/preview", transitionID), nil,
		testutil.WithJWTBearer(token),
	))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	require.NotEmpty(t, body.Data.Fingerprint)
	return map[string]string{"expected_fingerprint": body.Data.Fingerprint}
}
