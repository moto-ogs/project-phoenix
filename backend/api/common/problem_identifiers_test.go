//go:build testhooks

package common

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type nonWireMatch struct {
	ID int64 `json:"staff_record_id"`
}

func TestProblemDetailIdentifierGuard(t *testing.T) {
	t.Parallel()
	const id = 9007199254740993
	const smallID int64 = 1

	cases := []struct {
		name        string
		path        string
		details     map[string]any
		wantDetails string
		violation   bool
	}{
		{"typed", "/traeger/hire", map[string]any{"foo_id": ident.ID(id)}, `{"foo_id":"9007199254740993"}`, false},
		{"map", "/traeger/hire", map[string]any{"foo_id": smallID}, `{"foo_id":"1"}`, true},
		{"struct", "/traeger/hire", map[string]any{"matches": []nonWireMatch{{ID: id}}}, `{"matches":[{"staff_record_id":"9007199254740993"}]}`, true},
		{"list", "/api/calendar", map[string]any{"overlapping_period_ids": []int64{id, 1}, "limit": 2},
			`{"limit":2,"overlapping_period_ids":["9007199254740993","1"]}`, true},
		{"kiosk", "/api/iot/check-in", map[string]any{"room_id": smallID}, `{"room_id":1}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, nil)
			rec := httptest.NewRecorder()
			violated := false
			req = ObserveNumericProblemDetails(req, func() { violated = true })
			ProblemResponseMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				RenderError(w, r, ErrorConflictWithDetails(errors.New("conflict"), CodeGeneralBusinessRejection, tc.details))
			})).ServeHTTP(rec, req)
			assert.Equal(t, http.StatusConflict, rec.Code)
			assert.Contains(t, rec.Body.String(), `"details":`+tc.wantDetails)
			assert.Equal(t, tc.violation, violated)
		})
	}
}
