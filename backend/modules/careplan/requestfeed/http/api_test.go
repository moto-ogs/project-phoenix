package requestfeedhttp_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/modules/careplan/requestfeed"
	requestfeedhttp "github.com/moto-ogs/project-phoenix/modules/careplan/requestfeed/http"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubEngine struct {
	status requestfeed.Status
	feed   requestfeed.Feed
	err    error
}

func (s stubEngine) Status(context.Context, int64, int64) (requestfeed.Status, error) {
	return s.status, s.err
}

func (s stubEngine) Provision(context.Context, int64, int64) (requestfeed.Created, error) {
	return requestfeed.Created{}, s.err
}

func (s stubEngine) Rotate(context.Context, int64, int64) (requestfeed.Created, error) {
	return requestfeed.Created{}, s.err
}

func (s stubEngine) ByToken(context.Context, string) (requestfeed.Feed, error) {
	return s.feed, s.err
}

func testResource(engine stubEngine) *requestfeedhttp.Resource {
	return requestfeedhttp.NewResource(engine, requestfeedhttp.Runtime{
		Protected: func(router chi.Router, register func(chi.Router, requestfeedhttp.Middleware)) {
			register(router, func(next http.Handler) http.Handler { return next })
		},
		CurrentTenantID:  func(*http.Request) int64 { return 7 },
		CurrentAccountID: func(*http.Request) int64 { return 9 },
		Logger:           slog.New(slog.DiscardHandler),
		Success: func(w http.ResponseWriter, _ *http.Request, status int, data any, _ string) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": data})
		},
	})
}

func TestPublicFeedUsesUniformNotFoundResponse(t *testing.T) {
	t.Parallel()
	router := testResource(stubEngine{err: requestfeed.ErrNotFound}).PublicRouter()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/revoked-token", nil))

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.JSONEq(t, `{"status":404,"detail":"Not Found","code":"care.request_feed_not_found"}`, recorder.Body.String())
}

// A rotation without a feed names the missing feed, not a wrong input (#7688).
func TestRotateWithoutFeedAnswersFeedNotFound(t *testing.T) {
	t.Parallel()
	router := testResource(stubEngine{err: requestfeed.ErrNotFound}).TenantRouter()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/rotate", nil))

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.JSONEq(t, `{"status":404,"detail":"Not Found","code":"care.request_feed_not_found"}`, recorder.Body.String())
}

// Staff without school-wide request access is refused as such on every
// control; only the public feed keeps its uniform 404 (#7688).
func TestTenantControlsRefuseAccountsWithoutRequestAccess(t *testing.T) {
	t.Parallel()
	router := testResource(stubEngine{err: requestfeed.ErrNoAccess}).TenantRouter()
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, "/"}, {http.MethodPost, "/"}, {http.MethodPost, "/rotate"},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(request.method, request.path, nil))

		assert.Equal(t, http.StatusForbidden, recorder.Code, request.method+" "+request.path)
		assert.JSONEq(t, `{"status":403,"detail":"Forbidden","code":"general.permission"}`, recorder.Body.String(), request.method+" "+request.path)
	}
}

func TestPublicFeedDisablesCaching(t *testing.T) {
	t.Parallel()
	router := testResource(stubEngine{feed: requestfeed.Feed{XML: "<?xml version=\"1.0\"?><rss version=\"2.0\"></rss>"}}).PublicRouter()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/valid-token", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/rss+xml; charset=utf-8", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
	assert.Contains(t, recorder.Body.String(), "<rss")
}

func TestTenantStatusDoesNotExposeTheStoredLink(t *testing.T) {
	t.Parallel()
	router := testResource(stubEngine{status: requestfeed.Status{Active: true}}).TenantRouter()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"status":"success","data":{"active":true}}`, recorder.Body.String())
	assert.NotContains(t, recorder.Body.String(), "url")
}
