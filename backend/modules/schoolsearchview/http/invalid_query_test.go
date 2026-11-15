package schoolsearchviewhttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/schoolsearchview"
)

type neverSearch struct{}

func (neverSearch) SearchSchool(context.Context, schoolsearchview.Query) (schoolsearchview.Result, error) {
	panic("an invalid query never reaches the search")
}

// neverNotes fails a test that resolves the note audience for a refused query.
type neverNotes struct{}

func (neverNotes) NoteReader(context.Context) (*schoolsearchview.NoteReader, error) {
	panic("an invalid query never resolves the note audience")
}

// TestInvalidQueryNamesItsBounds answers a query outside the bounds with the
// shared input code and the bounds as details, so the dialog words the limit
// itself (ADR 0006).
func TestInvalidQueryNamesItsBounds(t *testing.T) {
	t.Parallel()
	direct := func(r chi.Router, mount func(chi.Router, func(http.Handler) http.Handler)) {
		mount(r, func(next http.Handler) http.Handler { return next })
	}
	router := NewResource(neverSearch{}, staffCheck{staff: true}, neverNotes{}).Router(direct)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"query":"a"}`)))

	require.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	var body struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	require.Equal(t, "general.input", body.Code)
	require.Equal(t, map[string]any{"min": float64(schoolsearchview.MinQueryRunes), "max": float64(schoolsearchview.MaxQueryRunes)}, body.Details)
}
