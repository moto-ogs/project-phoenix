package http_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	holidayClosureHTTP "github.com/moto-ogs/project-phoenix/workflows/holidayclosurenotification/http"
)

type routedNotice struct {
	ID        int64  `json:"id"`
	Token     string `json:"token"`
	Revision  int    `json:"revision"`
	Status    string `json:"status"`
	Families  int    `json:"families"`
	CanNotify bool   `json:"can_notify"`
}

// The school reads its proposal and tells the parents through its routes:
// the list shows the families a click tells, the click confirms the notice
// at the revision the school saw and writes one mail per family.
func TestSchoolRoutesListAndConfirmTheNotice(t *testing.T) {
	t.Parallel()
	w := newClosureWorld(t, "Träger Hinweis Route")
	w.createClosingDay(t, "2030-07-10", "2030-07-10")
	allow := func(next http.Handler) http.Handler { return next }
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, w.db))
	router.Mount("/api/holiday-closure-notices", holidayClosureHTTP.NewResource(w.notices, allow, allow, allow).SchoolRouter(rootAPI.ProtectedTenantRoutes))
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, w.db, w.school, "Schul", "Leitung")
	claims := testutil.TeacherTestClaims(int(account.ID))
	claims.TenantID = w.school
	bearer := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	send := func(method, path string, body any, out any) {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, "/api/holiday-closure-notices"+path, body, bearer))
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &struct{ Data any }{Data: out}))
	}

	var notices []routedNotice
	send(http.MethodGet, "/", nil, &notices)
	require.Len(t, notices, 1)
	notice := notices[0]
	assert.Equal(t, string(schoolcalendar.HolidayClosureSuggested), notice.Status)
	assert.True(t, notice.CanNotify)
	assert.Equal(t, 2, notice.Families)

	var confirmed routedNotice
	send(http.MethodPost, fmt.Sprintf("/%d/notify", notice.ID), map[string]any{"token": notice.Token, "revision": notice.Revision}, &confirmed)
	assert.Equal(t, notice.ID, confirmed.ID)
	assert.NotEqual(t, string(schoolcalendar.HolidayClosureSuggested), confirmed.Status)
	assert.Len(t, w.mails(t), 2, "one mail per family")
}
