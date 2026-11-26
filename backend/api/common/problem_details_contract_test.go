//go:build testhooks

package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

func TestProblemDetailsContractRejectsUnregisteredOrigins(t *testing.T) {
	t.Parallel()

	type mapAlias = map[string]any
	type imitation struct {
		Module      string `json:"module"`
		ModuleLabel string `json:"module_label"`
	}
	for _, probe := range []struct {
		name    string
		details any
		valid   bool
	}{
		{"registered", ModuleNotBookedDetails{Module: "zeiterfassung"}, true},
		{"aliased map", mapAlias{"module": "zeiterfassung", "module_label": ""}, false},
		{"same fields but different Go type", imitation{Module: "zeiterfassung"}, false},
	} {
		t.Run(probe.name, func(t *testing.T) {
			t.Parallel()
			router := chi.NewRouter()
			router.Get("/probe", func(w http.ResponseWriter, r *http.Request) {
				response := &ErrResponse{HTTPStatusCode: http.StatusForbidden, Code: CodeModuleNotBooked, Details: probe.details}
				err := response.Render(w, r)
				if probe.valid {
					require.NoError(t, err)
				} else {
					require.ErrorContains(t, err, "do not match their registered Go type")
				}
			})
			router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/probe", nil))
		})
	}
}
