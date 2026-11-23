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
// No statement duration: the series counts of other tests stay as they are.
func TestOperationMetricsLabelARefusalWithItsCode(t *testing.T) {
	t.Parallel()
	refusal := fmt.Errorf("save: %w", readstate.ErrChanged)
	// Every observer that labels an owner failure (15): a new one belongs here.
	observers := map[string]struct {
		counter *prometheus.CounterVec
		observe func(operation, label string, err error)
	}{
		"feedback": {feedbackOperations, func(operation, label string, err error) {
			ObserveFeedbackOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"organization tenancy": {organizationTenancyOperations, func(operation, label string, err error) {
			ObserveOrganizationTenancyOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"people directory": {peopleDirectoryOperations, func(operation, label string, err error) {
			ObservePeopleDirectoryOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"identity access": {identityAccessOperations, func(operation, label string, err error) {
			ObserveIdentityAccessOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"school membership": {schoolMembershipOperations, func(operation, label string, err error) {
			ObserveSchoolMembershipOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"school structure": {schoolStructureOperations, func(operation, label string, err error) {
			ObserveSchoolStructureOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"facilities": {facilitiesOperations, func(operation, label string, err error) {
			ObserveFacilitiesOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"file storage": {fileStorageOperations, func(operation, label string, err error) {
			ObserveFileStorageOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"device fleet": {deviceFleetOperations, func(operation, label string, err error) {
			ObserveDeviceFleetOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"school calendar": {schoolCalendarOperations, func(operation, label string, err error) {
			ObserveSchoolCalendarOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"workforce": {workforceOperations, func(operation, label string, err error) {
			ObserveWorkforceOperation(operation, time.Millisecond, 1, 0, 0, label, err)
		}},
		"timetable": {timetableActivitiesOperations, func(operation, label string, err error) {
			ObserveTimetableActivitiesOperation(operation, time.Millisecond, 1, 0, 0, 0, label, err)
		}},
		"appointments": {appointmentsOperations, func(operation, label string, err error) {
			ObserveAppointmentsOperation(operation, time.Millisecond, 1, 0, 0, 0, label, err)
		}},
		"communication": {communicationOperations, func(operation, label string, err error) {
			ObserveCommunicationOperation(operation, time.Millisecond, 1, 0, 0, 0, label, err)
		}},
		"care plan": {carePlanOperations, func(operation, label string, err error) {
			ObserveCarePlanOperation(operation, time.Millisecond, 1, 0, 0, 0, label, err)
		}},
	}
	for name, observer := range observers {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			operation := "operation_code_test_" + sanitizeLabel(name)
			label := "internal_error"
			if name == "file storage" {
				label = "internal"
			}
			refused := observer.counter.WithLabelValues(operation, "error", readstate.ChangedCode)
			internal := observer.counter.WithLabelValues(operation, "error", label)
			refusedBefore, internalBefore := testutil.ToFloat64(refused), testutil.ToFloat64(internal)
			observer.observe(operation, label, refusal)
			assert.Equal(t, refusedBefore+1, testutil.ToFloat64(refused))
			assert.Equal(t, internalBefore, testutil.ToFloat64(internal))
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
