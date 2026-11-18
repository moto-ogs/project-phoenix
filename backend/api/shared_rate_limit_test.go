package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	customMiddleware "github.com/moto-ogs/project-phoenix/middleware"
	identityCompose "github.com/moto-ogs/project-phoenix/modules/identityaccess/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestAuthRateLimitAcrossReplicas(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	first := testpkg.SetupServeTestDB(t)
	second := testpkg.SetupServeTestDB(t)
	t.Cleanup(func() { require.NoError(t, first.Close()) })
	t.Cleanup(func() { require.NoError(t, second.Close()) })

	fingerprint := requestRateLimitFingerprint(testpkg.TestJWTSecret)
	a := identityCompose.NewRequestRateLimits(first, fingerprint, requestRateLimitReservation, time.Now, slog.Default())
	b := identityCompose.NewRequestRateLimits(second, fingerprint, requestRateLimitReservation, time.Now, slog.Default())
	makeLimiter := func(store customMiddleware.RateLimitStore) authRateLimiters {
		return buildAuthRateLimiters(nil, "1", false, func(limit, burst int) *customMiddleware.RateLimiter {
			return customMiddleware.NewSharedRateLimiter(store, limit, burst)
		})
	}
	replicaA, replicaB := makeLimiter(a), makeLimiter(b)
	accept := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	refuse := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
	request := func(handler http.Handler) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/login", nil)
		r.RemoteAddr = "192.0.2.17:10000"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}

	for range 11 {
		require.Equal(t, http.StatusNoContent, request(replicaA.authMiddleware()(accept)).Code)
	}
	for range 9 {
		require.Equal(t, http.StatusUnauthorized, request(replicaA.authMiddleware()(refuse)).Code)
	}
	duringLastReservation := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		require.Equal(t, http.StatusTooManyRequests, request(replicaB.authMiddleware()(accept)).Code)
		w.WriteHeader(http.StatusNoContent)
	})
	require.Equal(t, http.StatusNoContent, request(replicaA.authMiddleware()(duringLastReservation)).Code)
	require.Equal(t, http.StatusUnauthorized, request(replicaB.authMiddleware()(refuse)).Code)
	rejected := request(replicaA.authMiddleware()(accept))
	require.Equal(t, http.StatusTooManyRequests, rejected.Code)
	require.Equal(t, "60", rejected.Header().Get("Retry-After"))
	require.Equal(t, http.StatusNoContent, request(replicaB.invitation.Middleware()(accept)).Code)
	// Advance the last spend by one refill interval in this isolated database.
	_, err := db.ExecContext(t.Context(), `UPDATE auth.request_rate_limits SET updated_at = updated_at - interval '1 minute'`)
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, request(replicaB.authMiddleware()(refuse)).Code)
	require.Equal(t, http.StatusTooManyRequests, request(replicaA.authMiddleware()(accept)).Code)
}
