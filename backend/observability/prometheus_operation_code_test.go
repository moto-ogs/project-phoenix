package observability

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
)

// An owner's table labels readstate.ErrChanged as internal_error; the
// operation metric counts it with its registered code instead (ADR 0311).
func TestOperationMetricsLabelARefusalWithItsCode(t *testing.T) {
	t.Parallel()
	refusal := fmt.Errorf("save: %w", readstate.ErrChanged)
	observers := map[string]struct {
		counter *prometheus.CounterVec
		observe func(operation string, err error)
	}{
		"care plan": {carePlanOperations, func(operation string, err error) {
			ObserveCarePlanOperation(operation, time.Millisecond, 1, 0, 0, time.Millisecond, "internal_error", err)
		}},
		"timetable": {timetableActivitiesOperations, func(operation string, err error) {
			ObserveTimetableActivitiesOperation(operation, time.Millisecond, 1, 0, 0, time.Millisecond, "internal_error", err)
		}},
		"workforce": {workforceOperations, func(operation string, err error) {
			ObserveWorkforceOperation(operation, time.Millisecond, 1, 0, time.Millisecond, "internal_error", err)
		}},
		"organization tenancy": {organizationTenancyOperations, func(operation string, err error) {
			ObserveOrganizationTenancyOperation(operation, time.Millisecond, 1, 0, time.Millisecond, "internal_error", err)
		}},
		"facilities": {facilitiesOperations, func(operation string, err error) {
			ObserveFacilitiesOperation(operation, time.Millisecond, 1, 0, time.Millisecond, "internal_error", err)
		}},
		"school calendar": {schoolCalendarOperations, func(operation string, err error) {
			ObserveSchoolCalendarOperation(operation, time.Millisecond, 1, 0, time.Millisecond, "internal_error", err)
		}},
		"file storage": {fileStorageOperations, func(operation string, err error) {
			ObserveFileStorageOperation(operation, time.Millisecond, 1, 0, time.Millisecond, "internal", err)
		}},
	}
	for name, observer := range observers {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			operation := "operation_code_test_" + sanitizeLabel(name)
			observer.observe(operation, refusal)
			assert.Equal(t, 1.0, testutil.ToFloat64(observer.counter.WithLabelValues(operation, "error", readstate.ChangedCode)))
			assert.Equal(t, 0.0, testutil.ToFloat64(observer.counter.WithLabelValues(operation, "error", "internal_error")))
		})
	}
}

func TestOperationCodeKeepsTheOwnersLabel(t *testing.T) {
	t.Parallel()
	refusal := fmt.Errorf("save: %w", readstate.ErrChanged)
	assert.Equal(t, "not_found", operationCode("not_found", refusal), "the owner's table names its own failures")
	assert.Equal(t, "internal_error", operationCode("internal_error", errors.New("boom")))
	assert.Equal(t, readstate.ChangedCode, operationCode("internal", refusal))
}
