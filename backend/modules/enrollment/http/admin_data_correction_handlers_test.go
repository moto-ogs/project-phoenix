package enrollmenthttp

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// correctionChangeRequestService records the correction the route hands on
// and answers the audit change request it would have written.
type correctionChangeRequestService struct {
	ChangeRequestService
	input CorrectApprovedChildDataInput
}

func (s *correctionChangeRequestService) CorrectApprovedChildData(_ context.Context, input CorrectApprovedChildDataInput) (*ChangeRequestAggregate, error) {
	s.input = input
	at := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	return &ChangeRequestAggregate{ChangeRequest: &ChangeRequest{
		ID: 31, RequestID: input.RequestID, RequestChildID: &input.ChildID, Origin: "admin", Status: "approved",
		Diff: map[string]any{"changed": []any{"children"}}, CreatedAt: at, UpdatedAt: at,
	}}, nil
}

// The office corrects an approved child's master data on the backend's own
// path (#7563): the IDs travel in the path, the corrected values in the body.
func TestCorrectAdminChildDataReadsTheIDsFromThePath(t *testing.T) {
	t.Parallel()

	service := &correctionChangeRequestService{}
	rs := &Resource{
		Now:                  resourceTestClock,
		Failures:             DatabaseFailures{Transient: transactionFailures.IsTransientDatabaseError, Constraint: transactionFailures.IsConstraintViolation},
		ChangeRequestService: service,
	}
	router := chi.NewRouter()
	router.Use(render.SetContentType(render.ContentTypeJSON))
	router.Put("/enrollment/admin/requests/{id}/children/{childId}/data-correction", rs.correctAdminChildData)

	grade := 2
	w := executeAdminJSON(t, router, http.MethodPut, "/enrollment/admin/requests/12/children/34/data-correction", map[string]any{
		"first_name": "Lina", "last_name": "Richtig", "date_of_birth": "2018-05-16",
		"target_grade_level": grade, "reason": "Angaben nach Rücksprache berichtigt",
	})

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, int64(12), service.input.RequestID)
	assert.Equal(t, int64(34), service.input.ChildID)
	assert.Equal(t, "Richtig", service.input.LastName)
	assert.Equal(t, calendar.NewDate(2018, 5, 16), service.input.DateOfBirth)
	require.NotNil(t, service.input.TargetGradeLevel)
	assert.Equal(t, int16(2), *service.input.TargetGradeLevel)
	assert.Contains(t, w.Body.String(), `"request_id":"12"`)
}
