//go:build testhooks

package common

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The answer check runs in every test binary. These cases hold it to what it
// promises: a registered route that leaves the contract is refused, anything
// else passes untouched.
func TestAnswersOfRegisteredRoutesAreHeldAgainstTheContract(t *testing.T) {
	t.Parallel()
	router := chi.NewRouter()
	router.Get("/school/supervisions/{id}/roster", func(w http.ResponseWriter, r *http.Request) {
		Respond(w, r, http.StatusOK, map[string]any{"rows": []string{}}, "ok")
	})
	router.Post("/school/supervisions/{id}/start", func(w http.ResponseWriter, r *http.Request) {
		RespondNoContent(w, r)
	})
	router.Delete("/school/class-day/homework/{schoolClass}/{homeworkId}", func(w http.ResponseWriter, r *http.Request) {
		RespondNoContent(w, r)
	})
	router.Get("/not-registered/{id}/roster", func(w http.ResponseWriter, r *http.Request) {
		Respond(w, r, http.StatusOK, map[string]any{"rows": []string{}}, "ok")
	})
	// A route-sized router: the pattern alone names no registered route, and
	// the answer's Go type is none the contract registers for it.
	relative := chi.NewRouter()
	relative.Get("/{id}/roster", func(w http.ResponseWriter, r *http.Request) {
		Respond(w, r, http.StatusOK, map[string]any{"rows": []string{}}, "ok")
	})

	serve := func(handler http.Handler, method, target string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
		return recorder
	}

	refused := serve(router, http.MethodGet, "/school/supervisions/7/roster")
	assert.Equal(t, http.StatusInternalServerError, refused.Code)
	assert.Contains(t, refused.Body.String(), "leaves the contract")
	assert.Contains(t, refused.Body.String(), "data.instance: the key is absent")

	noContent := serve(router, http.MethodPost, "/school/supervisions/7/start")
	assert.Equal(t, http.StatusInternalServerError, noContent.Code, "a route that registers data may not answer 204")

	assert.Equal(t, http.StatusNoContent, serve(router, http.MethodDelete, "/school/class-day/homework/1a/7").Code)
	assert.Equal(t, http.StatusOK, serve(router, http.MethodGet, "/not-registered/7/roster").Code)
	assert.Equal(t, http.StatusOK, serve(relative, http.MethodGet, "/7/roster").Code)
}

// A handler that reads a body its contract does not type is refused: no
// typed client could send it (#7808). A body the handler leaves unread is a
// test sending more than the route takes.
func TestAHandlerReadingAnUntypedBodyIsRefused(t *testing.T) {
	t.Parallel()
	serve := func(read bool) int {
		router := chi.NewRouter()
		router.Delete("/school/class-day/homework/{schoolClass}/{homeworkId}", func(w http.ResponseWriter, r *http.Request) {
			if read {
				_, _ = io.ReadAll(r.Body)
			}
			RespondNoContent(w, r)
		})
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/school/class-day/homework/1a/7", strings.NewReader(`{"reason":"x"}`)))
		return recorder.Code
	}
	assert.Equal(t, http.StatusInternalServerError, serve(true))
	assert.Equal(t, http.StatusNoContent, serve(false))
}

func TestAnswerCoverageRequiresAnUnambiguousRoute(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name    string
		mount   string
		pattern string
		target  string
		want    []string
	}{
		{
			name:    "ambiguous relative route",
			pattern: "/{id}",
			target:  "/7",
		},
		{
			name:    "explicit report-template mount",
			mount:   "/traeger/report-templates",
			pattern: "/{id}",
			target:  "/traeger/report-templates/7",
			want:    []string{"DELETE /traeger/report-templates/{id}"},
		},
		{
			name:    "explicit document mount",
			mount:   "/traeger/documents",
			pattern: "/{id}",
			target:  "/traeger/documents/7",
			want:    []string{"DELETE /traeger/documents/{id}"},
		},
		{
			name:    "unique relative route",
			pattern: "/homework/{schoolClass}/{homeworkId}",
			target:  "/homework/1a/7",
			want:    []string{"DELETE /school/class-day/homework/{schoolClass}/{homeworkId}"},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var recorded []string
			relative := chi.NewRouter()
			relative.Delete(tt.pattern, func(w http.ResponseWriter, r *http.Request) {
				err := loadAnswerContract().observe(r, http.StatusNoContent, nil, nil, func(key string) {
					recorded = append(recorded, key)
				})
				require.NoError(t, err)
				w.WriteHeader(http.StatusNoContent)
			})
			var handler http.Handler = relative
			if tt.mount != "" {
				router := chi.NewRouter()
				router.Mount(tt.mount, relative)
				handler = router
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, tt.target, nil))
			assert.Equal(t, http.StatusNoContent, recorder.Code)
			assert.Equal(t, tt.want, recorded)
		})
	}
}
