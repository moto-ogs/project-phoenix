package account_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	identityaccessCompose "github.com/moto-ogs/project-phoenix/modules/identityaccess/compose"
	authAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestPasswordResetRateLimitKeepsUnknownAndKnownResponsesEqual(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	module := setupAuthModuleOn(t, db, api.WithAuthTestPasswordResetRateLimit(true), api.WithAuthTestMailer(testpkg.NewCapturingMailer()), api.WithAuthTestPasswordResetBackoff(time.Millisecond))
	settings := api.NewAuthTestSettings(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	resource := authAPI.NewResource(module.Auth, module.Invitation, testSchoolDirectory{schools: api.NewOrganizationTestRows(testpkg.NewDatabase(t, db)).School, db: db, runtime: testpkg.TenantRuntime(t, db)}, module.AccountAuthentication, identityaccessCompose.TenantUnitOfWork{}, transactionFailures.IsConstraintViolation, settings)

	router := testutil.NewTenantRouter(db)
	router.Mount("/auth", resource.Router(api.TenantSessionChain))
	account := testpkg.CreateTestAccount(t, db, "reset-wire-privacy")
	known := resetAnswers(t, router, account.Email)
	unknown := resetAnswers(t, router, fmt.Sprintf("no-account-%d@example.test", testpkg.Tenant(t)))

	// The answers are compared with each other, not only with a shape: any
	// difference between an existing and a missing account is a leak (#7213).
	require.Len(t, known, resetThreshold+2)
	for i := range known {
		require.Equal(t, known[i].status, unknown[i].status, "request %d", i+1)
		require.JSONEq(t, known[i].body, unknown[i].body, "request %d", i+1)
		require.InDelta(t, known[i].retryAfter, unknown[i].retryAfter, 2, "request %d", i+1)
	}
	for i, answer := range known {
		if i < resetThreshold {
			require.Equal(t, http.StatusOK, answer.status, answer.body)
			require.Zero(t, answer.retryAfter)
			continue
		}
		require.Equal(t, http.StatusTooManyRequests, answer.status, answer.body)
		require.Contains(t, answer.body, "identity.password_reset_rate_limited")
		require.Positive(t, answer.retryAfter)
		require.LessOrEqual(t, answer.retryAfter, 3600)
	}
}

// resetThreshold is the documented wire contract: three requests per address
// and hour pass, the fourth is refused.
const resetThreshold = 3

type resetAnswer struct {
	status     int
	body       string
	retryAfter int
}

// resetAnswers requests a reset for the address once past the threshold
// and again while it is refused, as someone probing an address would.
func resetAnswers(t *testing.T, router chi.Router, address string) []resetAnswer {
	t.Helper()
	answers := make([]resetAnswer, 0, resetThreshold+2)
	for range resetThreshold + 2 {
		req := testutil.NewJSONRequest(t, http.MethodPost, "/auth/password-reset", map[string]string{"email": address})
		rr := testutil.ExecuteRequest(router, req)
		answer := resetAnswer{status: rr.Code, body: withoutInstance(t, rr.Body.Bytes())}
		if header := rr.Header().Get("Retry-After"); header != "" {
			seconds, err := strconv.Atoi(header)
			require.NoError(t, err)
			answer.retryAfter = seconds
		}
		answers = append(answers, answer)
	}
	return answers
}

// withoutInstance drops the per-request problem instance, the one member
// that differs between any two requests.
func withoutInstance(t *testing.T, body []byte) string {
	t.Helper()
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(body, &decoded), string(body))
	delete(decoded, "instance")
	normalized, err := json.Marshal(decoded)
	require.NoError(t, err)
	return string(normalized)
}
