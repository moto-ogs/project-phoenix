package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	customMiddleware "github.com/moto-ogs/project-phoenix/middleware"
	"github.com/stretchr/testify/assert"
)

// The public links (the holiday link, the school's online enrollment) are
// exempt from the general limiter, so their own limit must never be tighter
// than the general one. Production runs the general limiter at 600 a minute
// with a burst of 100; the first limit of the holiday link, 300 a minute,
// halved what the link had before (#6726).
func TestPublicLinkLimitsAreNeverTighterThanTheGeneralLimiter(t *testing.T) {
	t.Parallel()
	for _, general := range []struct{ limit, burst int }{
		{60, 10},     // defaults of the code
		{600, 100},   // production and staging
		{5000, 1000}, // a general limit above the floor of the link
	} {
		limit, burst := publicLinkLimits(general.limit, general.burst)
		assert.GreaterOrEqual(t, limit, general.limit, "requests per minute beside a general limit of %d", general.limit)
		assert.GreaterOrEqual(t, burst, general.burst, "burst beside a general burst of %d", general.burst)
		assert.GreaterOrEqual(t, limit, publicLinkRequestsPerMinute)
		assert.GreaterOrEqual(t, burst, publicLinkBurst)
	}
}

// stoppedClockRateLimiter is the production limiter on a clock that stands
// still. A burst test spends several hundred tokens; on a loaded runner the
// wall clock would refill one before the request past the burst (#7644).
func stoppedClockRateLimiter(limit, burst int) *customMiddleware.RateLimiter {
	limiter := customMiddleware.NewRateLimiter(limit, burst)
	stopped := time.Date(2026, time.November, 20, 12, 0, 0, 0, time.UTC)
	limiter.SetClock(func() time.Time { return stopped })
	return limiter
}

// A school network opens the link at once: every request of the burst
// passes, the one after it is refused, reads and writes apart.
func TestHolidayRegistrationRateLimitLetsItsBurstThrough(t *testing.T) {
	t.Parallel()
	limited := holidayRegistrationRateLimit(true, false, stoppedClockRateLimiter)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	send := func(method string) int {
		rec := httptest.NewRecorder()
		limited.ServeHTTP(rec, httptest.NewRequest(method, holidayRegistrationPath+"/token", nil))
		return rec.Code
	}
	_, burst := publicLinkLimits(generalRateLimitFromEnv())
	for i := range burst {
		if code := send(http.MethodGet); code != http.StatusOK {
			t.Fatalf("read %d of the burst of %d: status %d", i+1, burst, code)
		}
	}
	assert.Equal(t, http.StatusTooManyRequests, send(http.MethodGet), "the read past the burst")
	assert.Equal(t, http.StatusOK, send(http.MethodPost), "writes have a budget of their own")
	assert.Nil(t, holidayRegistrationRateLimit(false, false, customMiddleware.NewRateLimiter), "no limiter while rate limiting is off")
}

// The signing link of a contract mail has the shared limit of the public
// links too, with buckets of its own: a family that opens the link and signs
// does not spend the budget of the holiday link.
func TestCareContractSigningRateLimitLetsItsBurstThrough(t *testing.T) {
	t.Parallel()
	limited := careContractSigningRateLimit(true, false, stoppedClockRateLimiter)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	send := func(method string) int {
		rec := httptest.NewRecorder()
		limited.ServeHTTP(rec, httptest.NewRequest(method, careContractSigningPath+"/link", nil))
		return rec.Code
	}
	_, burst := publicLinkLimits(generalRateLimitFromEnv())
	for i := range burst {
		if code := send(http.MethodGet); code != http.StatusOK {
			t.Fatalf("read %d of the burst of %d: status %d", i+1, burst, code)
		}
	}
	assert.Equal(t, http.StatusTooManyRequests, send(http.MethodGet), "the read past the burst")
	assert.Equal(t, http.StatusOK, send(http.MethodPost), "writes have a budget of their own")
	assert.Nil(t, careContractSigningRateLimit(false, false, customMiddleware.NewRateLimiter), "no limiter while rate limiting is off")
}
