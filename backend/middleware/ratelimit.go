package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"golang.org/x/time/rate"
)

// RateLimitStore is the request limiter's shared admission and settlement port.
type RateLimitStore interface {
	Admit(ctx context.Context, key string, requestsPerMinute, burst int, reserve bool) (settle func(spend bool) error, err error)
}

// RateLimiter applies a token bucket to HTTP requests.
type RateLimiter struct {
	store             RateLimitStore
	requestsPerMinute int
	visitors          map[string]*visitor
	mu                sync.RWMutex
	r                 rate.Limit // requests per second
	b                 int        // burst size
	ttl               time.Duration
	logger            *SecurityLogger // optional security logger
	keyFunc           func(*http.Request) string
	bucketFunc        func(*http.Request) string
	rejectObserver    func(bucket string)
	exemptPrefixes    []string
	exemptRequests    []func(*http.Request) bool
	exemptLoopback    bool
	Now               func() time.Time // token clock; nil is the wall clock
	refusalsOnly      bool
	alwaysSpends      func(*http.Request) bool
}

// visitor tracks rate limiting for a single request key. pending counts the
// requests of a failures-only limiter that hold a token while their handler
// runs.
type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
	pending  int
}

// NewRateLimiter creates a per-process limiter. The general load guard uses
// it so ordinary requests never need a database write. N replicas provide
// N times the configured quota in aggregate.
func NewRateLimiter(requestsPerMinute, burst int) *RateLimiter {
	rl := &RateLimiter{
		visitors:          make(map[string]*visitor),
		requestsPerMinute: requestsPerMinute,
		r:                 rate.Limit(float64(requestsPerMinute) / 60.0), // convert to per second
		b:                 burst,
		ttl:               3 * time.Minute, // cleanup visitors after 3 minutes of inactivity
		logger:            nil,             // can be set with SetLogger
	}

	// Start cleanup goroutine
	go rl.cleanupVisitors()

	return rl
}

// NewSharedRateLimiter uses the same HTTP policy with shared counters.
func NewSharedRateLimiter(store RateLimitStore, requestsPerMinute, burst int) *RateLimiter {
	return &RateLimiter{
		store: store, requestsPerMinute: requestsPerMinute,
		r: rate.Limit(float64(requestsPerMinute) / 60), b: burst,
	}
}

func (rl *RateLimiter) clock() time.Time {
	if rl.Now == nil {
		return time.Now()
	}
	return rl.Now()
}

// SetLogger sets the security logger for the rate limiter
func (rl *RateLimiter) SetLogger(logger *SecurityLogger) {
	rl.logger = logger
}

// SetKeyFunc sets the request key function for the rate limiter.
// If keyFunc returns an empty key, the limiter falls back to the client IP.
func (rl *RateLimiter) SetKeyFunc(keyFunc func(*http.Request) string) {
	rl.keyFunc = keyFunc
}

// SetBucketFunc partitions one identity's quota into independent buckets.
// The general API limiter uses this to keep SSE-driven reads from consuming
// the write budget. Auth and webhook limiters use a fixed bucket name for
// metrics; their instances still have independent quotas.
func (rl *RateLimiter) SetBucketFunc(bucketFunc func(*http.Request) string) {
	rl.bucketFunc = bucketFunc
}

// SetRejectObserver records rejected requests without coupling this generic
// middleware to a metrics implementation.
func (rl *RateLimiter) SetRejectObserver(observer func(bucket string)) {
	rl.rejectObserver = observer
}

// ExemptLoopback lets requests from a loopback TCP peer bypass the limiter.
// The public demo enables it for its demo process, which shares the server
// container's network namespace and calls the API on 127.0.0.1 while it
// seeds and ticks demo schools. Everything else keeps its limits.
func (rl *RateLimiter) ExemptLoopback() {
	rl.exemptLoopback = true
}

// SpendOnRefusals makes the limiter spend a token only on a refused request
// (a 4xx answer of the handler) and on a request alwaysSpends reports, such
// as one that sends a mail; nil reports none. An accepted or failed (5xx)
// request gives its token back.
//
// A request needs a free token to enter and holds it while its handler runs,
// so parallel requests cannot pass together beyond the burst: at most burst
// requests of one key run at once, however many of them succeed.
//
// The login limiter uses it (#6738); docs/agents/contracts.md, "Client IP and
// rate limits", explains why.
func (rl *RateLimiter) SpendOnRefusals(alwaysSpends func(*http.Request) bool) {
	rl.refusalsOnly = true
	rl.alwaysSpends = alwaysSpends
}

// ExemptPathPrefix lets a route that has its own limiter bypass this one.
func (rl *RateLimiter) ExemptPathPrefix(prefix string) {
	rl.exemptPrefixes = append(rl.exemptPrefixes, prefix)
}

// ExemptRequest lets the requests match selects bypass this limiter, for
// routes with their own limiter that no path prefix describes.
func (rl *RateLimiter) ExemptRequest(match func(*http.Request) bool) {
	rl.exemptRequests = append(rl.exemptRequests, match)
}

func (rl *RateLimiter) exemptPath(r *http.Request) bool {
	for _, prefix := range rl.exemptPrefixes {
		if strings.HasPrefix(r.URL.Path, prefix) {
			return true
		}
	}
	for _, match := range rl.exemptRequests {
		if match(r) {
			return true
		}
	}
	return false
}

// isLoopbackPeer reports whether the request's TCP peer is a loopback address.
//
// The root router rewrites RemoteAddr from the rightmost X-Forwarded-For entry
// (ClientIPFromXFFTrustedProxies and syncClientIPToRemoteAddr in api/serve_middleware.go), so a request
// that carries the header has a RemoteAddr chosen by a header, not by the
// connection. Only a request without the header still holds the TCP peer, and
// only such a request can be exempt.
//
// Public traffic never qualifies: Caddy on the host sets X-Forwarded-For and
// reaches the container through Docker's published port, where the peer is
// the bridge gateway (for example 172.18.0.1), never loopback. The container's
// loopback is reachable only from inside the server's network namespace.
func isLoopbackPeer(r *http.Request) bool {
	if len(r.Header.Values("X-Forwarded-For")) > 0 {
		return false
	}
	ip := net.ParseIP(GetClientIP(r))
	return ip != nil && ip.IsLoopback()
}

func defaultRateLimitKey(r *http.Request) string {
	return "ip:" + GetClientIP(r)
}

func (rl *RateLimiter) requestBucket(r *http.Request) string {
	if rl.bucketFunc == nil {
		return ""
	}
	return rl.bucketFunc(r)
}

func (rl *RateLimiter) requestKeyForBucket(r *http.Request, bucket string) string {
	key := defaultRateLimitKey(r)
	if rl.keyFunc != nil {
		if customKey := rl.keyFunc(r); customKey != "" {
			key = customKey
		}
	}
	if bucket != "" {
		return key + ":" + bucket
	}
	return key
}

func (rl *RateLimiter) retryAfterSeconds() int {
	if rl.r <= 0 {
		return 60
	}
	return max(1, int(math.Ceil(1/float64(rl.r))))
}

func (rl *RateLimiter) reject(w http.ResponseWriter, r *http.Request, bucket string) {
	retryAfter := rl.retryAfterSeconds()
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rl.requestsPerMinute))
	w.Header().Set("X-RateLimit-Remaining", "0")
	w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", time.Now().Add(time.Duration(retryAfter)*time.Second).Unix()))
	w.Header().Set("Retry-After", strconv.Itoa(retryAfter))

	if rl.rejectObserver != nil {
		if bucket == "" {
			bucket = "shared"
		}
		rl.rejectObserver(bucket)
	}
	if rl.logger != nil {
		rl.logger.LogRateLimitExceeded(r)
	}
	writeRateLimitProblem(w, rateLimitProblem{
		Status: http.StatusTooManyRequests,
		Detail: "Rate limit exceeded. Please try again later.",
		Code:   codeGeneralUnavailable,
	})
}

func writeRateLimitProblem(w http.ResponseWriter, problem rateLimitProblem) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(problem.Status)
	// rateLimitProblem contains only an int and strings and cannot fail to encode.
	body, _ := wire.Marshal(problem)
	_, _ = w.Write(append(body, '\n'))
}

// codeGeneralUnavailable is the registered class code (error-registry/)
// of a rate-limited request. This package may not import api/common, so it
// names the code once here.
const codeGeneralUnavailable = "general.unavailable"

// rateLimitProblem is the shared error envelope (ADR 0006) of a rejected
// request: the HTTP status number, the diagnostic text and the registered
// code. ProblemResponseMiddleware adds type, title and instance like for
// every error answer.
type rateLimitProblem struct {
	Status int    `json:"status"`
	Detail string `json:"detail"`
	Code   string `json:"code"`
}

// visitorLocked returns the visitor of the request key and marks it seen.
// The caller holds rl.mu.
func (rl *RateLimiter) visitorLocked(key string) *visitor {
	v, exists := rl.visitors[key]
	if !exists {
		v = &visitor{limiter: rate.NewLimiter(rl.r, rl.b)}
		rl.visitors[key] = v
	}
	v.lastSeen = time.Now()
	return v
}

// getVisitor returns the rate limiter for the given request key.
func (rl *RateLimiter) getVisitor(key string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	return rl.visitorLocked(key).limiter
}

// admitPending lets a request of a failures-only limiter in while a token is
// free beside the ones running requests hold, and holds one for it.
func (rl *RateLimiter) admitPending(key string) (*visitor, bool) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	v := rl.visitorLocked(key)
	if v.limiter.TokensAt(rl.clock()) < float64(v.pending+1) {
		return nil, false
	}
	v.pending++
	return v, true
}

// settlePending releases the token a request held, or spends it.
func (rl *RateLimiter) settlePending(v *visitor, spend bool) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	v.pending--
	v.lastSeen = time.Now()
	if spend {
		v.limiter.AllowN(rl.clock(), 1)
	}
}

func (rl *RateLimiter) admit(r *http.Request, bucket string) (func(bool) error, error) {
	key := rl.requestKeyForBucket(r, bucket)
	if rl.store != nil {
		return rl.store.Admit(r.Context(), key, rl.requestsPerMinute, rl.b, rl.refusalsOnly)
	}
	if rl.refusalsOnly {
		visitor, ok := rl.admitPending(key)
		if !ok {
			return nil, nil
		}
		return func(spend bool) error { rl.settlePending(visitor, spend); return nil }, nil
	}
	if !rl.getVisitor(key).AllowN(rl.clock(), 1) {
		return nil, nil
	}
	return func(bool) error { return nil }, nil
}

func (rl *RateLimiter) serveCountingFailures(w http.ResponseWriter, r *http.Request, next http.Handler, settle func(bool) error) {
	alwaysSpends := rl.alwaysSpends != nil && rl.alwaysSpends(r)
	ww := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
	defer func() {
		status := ww.Status()
		if err := settle(alwaysSpends || (status >= http.StatusBadRequest && status < http.StatusInternalServerError)); err != nil {
			slog.ErrorContext(r.Context(), "settle request rate limit", "error", err.Error())
		}
	}()
	next.ServeHTTP(ww, r)
}

// cleanupVisitors removes old entries from the visitors map
func (rl *RateLimiter) cleanupVisitors() {
	for {
		time.Sleep(time.Minute)

		rl.mu.Lock()
		for ip, v := range rl.visitors {
			if v.pending == 0 && time.Since(v.lastSeen) > rl.ttl {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware returns the rate limiting middleware
func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if (rl.exemptLoopback && isLoopbackPeer(r)) || rl.exemptPath(r) {
				next.ServeHTTP(w, r)
				return
			}
			bucket := rl.requestBucket(r)
			settle, err := rl.admit(r, bucket)
			switch {
			case err != nil:
				slog.ErrorContext(r.Context(), "check request rate limit", "error", err.Error())
				writeRateLimitProblem(w, rateLimitProblem{
					Status: http.StatusServiceUnavailable, Code: codeGeneralUnavailable,
					Detail: "Rate limit temporarily unavailable.",
				})
			case settle == nil:
				rl.reject(w, r, bucket)
			case rl.refusalsOnly:
				rl.serveCountingFailures(w, r, next, settle)
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}

// GetClientIP extracts the real client IP address from the request
func GetClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
