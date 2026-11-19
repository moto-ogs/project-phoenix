package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type recordedPWAUsage struct{ accounts []int64 }

func (u *recordedPWAUsage) ReportStaff(_ context.Context, accountID int64) error {
	u.accounts = append(u.accounts, accountID)
	return nil
}

// A staff session reports that it runs as the installed app; the report
// names the caller's account, and the route answers no data.
func TestPWAUsageRouteReportsTheCallersAccount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	usage := &recordedPWAUsage{}
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/pwa", pwaUsageRouter(usage))
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "App", "Nutzung")
	claims := testutil.TeacherTestClaims(int(account.ID))
	claims.TenantID = testpkg.Tenant(t)
	request := testutil.NewAuthenticatedRequest(t, http.MethodPost, "/api/pwa/usage", nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))

	response := testutil.ExecuteRequestForTest(t, router, request)

	require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
	assert.Equal(t, []int64{account.ID}, usage.accounts)
}
