package enrollmenthttp

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A service period beyond its bounds (#5658) answers with its own code at the
// end date, on the phase routes and on the rollover route alike.
func TestServicePeriodBounds_AnswerWithCodeAtTheEndDate(t *testing.T) {
	t.Parallel()

	today := calendar.NewDate(2026, 11, 18)
	tooLong := capability.ValidateServicePeriodBounds("2026-08-01", "2028-08-02", today)
	tooFar := capability.ValidateServicePeriodBounds("2030-08-01", "2031-11-19", today)

	for code, rejection := range map[string]error{
		"enrollment.phase_service_period_too_long": tooLong,
		"enrollment.phase_service_end_too_far":     tooFar,
	} {
		w := renderTo(phaseWriteErrorRenderer(fmt.Errorf("%w: %w", capability.ErrInvalidPhase, rejection)))
		assert.Equal(t, http.StatusBadRequest, w.Code)
		body := readCodedAnswer(t, w)
		assert.Equal(t, code, body.Code)
		require.Len(t, body.Errors, 1)
		assert.Equal(t, "service_end_date", body.Errors[0].Field)

		rs := &Resource{
			Now:      resourceTestClock,
			Failures: DatabaseFailures{Transient: transactionFailures.IsTransientDatabaseError, Constraint: transactionFailures.IsConstraintViolation}}
		w = httptest.NewRecorder()
		rs.mapRolloverError(w, httptest.NewRequest(http.MethodPost, "/x", nil), fmt.Errorf("%w: %w", capability.ErrRolloverInvalidRequest, rejection))
		assert.Equal(t, http.StatusBadRequest, w.Code)
		body = readCodedAnswer(t, w)
		assert.Equal(t, code, body.Code)
		require.Len(t, body.Errors, 1)
		assert.Equal(t, "service_end_date", body.Errors[0].Field)
	}
}
