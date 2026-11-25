package parent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
	"github.com/stretchr/testify/require"
)

func (f *fakeParentService) FamilyStart(_ context.Context, accountID int64, studentID *int64) (*parentService.FamilyStart, error) {
	f.gotTodayAccount = accountID
	if studentID != nil {
		f.gotTodayStudent = *studentID
	}
	return &parentService.FamilyStart{Day: calendar.NewDate(2026, 11, 24)}, nil
}

func TestFamilyStartRoute(t *testing.T) {
	t.Parallel()
	svc := &fakeParentService{}
	rs := &Resource{ParentService: svc}
	router := chi.NewRouter()
	router.Get("/parent/me/family-start", rs.familyStart)
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"", 200}, {"?student_id=42", 200}, {"?student_id=", 400}, {"?student_id=42&student_id=43", 400},
	} {
		w := httptest.NewRecorder()
		req := withClaims(httptest.NewRequest(http.MethodGet, "/parent/me/family-start"+tc.query, nil), 7777)
		router.ServeHTTP(w, req)
		require.Equal(t, tc.want, w.Code)
		if w.Code == 200 {
			require.Contains(t, w.Body.String(), `"cards":[]`)
			require.EqualValues(t, 7777, svc.gotTodayAccount)
		}
	}
	require.EqualValues(t, 42, svc.gotTodayStudent)
}
