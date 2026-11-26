package careplanhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/stretchr/testify/require"
)

func TestCompanionConflictUsesProblemDetailsWithExactStudentID(t *testing.T) {
	t.Parallel()

	conflict := &companionConflictError{Conflicts: []careplan.CompanionConflict{{
		StudentID: 9007199254740993,
		Weekdays:  []string{"mon"},
	}}}
	handler := common.ProblemResponseMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		common.RenderError(w, r, companionConflictRenderer(conflict))
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/students/1", nil))

	require.Equal(t, http.StatusConflict, response.Code)
	require.Contains(t, response.Body.String(), `"code":"students.companion_plan_conflict"`)
	require.Contains(t, response.Body.String(), `"details":{"conflicts":[{"student_id":"9007199254740993","weekdays":["mon"]}]}`)
}
