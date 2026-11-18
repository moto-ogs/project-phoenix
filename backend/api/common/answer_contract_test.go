//go:build testhooks

package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
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
