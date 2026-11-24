package application

import (
	"errors"
	"fmt"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// A booking adjustment over a stale read is a refusal, not a server error:
// the metric counts it with its registered code (ADR 0311), and an
// unclassified failure stays internal_error.
func TestOfferingBookingMetricsLabelAStaleReadWithItsCode(t *testing.T) {
	t.Parallel()
	observe := ObserveOfferingBookings()
	operation := "offering_booking_metrics_test"
	refused := offeringBookingOperations.WithLabelValues(operation, "command", "error", readstate.ChangedCode)
	internal := offeringBookingOperations.WithLabelValues(operation, "command", "error", "internal_error")
	refusedBefore, internalBefore := testutil.ToFloat64(refused), testutil.ToFloat64(internal)

	observe(careplan.OfferingBookingObservation{Operation: operation, Kind: "command", OutputRows: -1, Err: fmt.Errorf("adjust: %w", readstate.ErrChanged)})
	assert.Equal(t, refusedBefore+1, testutil.ToFloat64(refused))
	assert.Equal(t, internalBefore, testutil.ToFloat64(internal))

	observe(careplan.OfferingBookingObservation{Operation: operation, Kind: "command", OutputRows: -1, Err: errors.New("boom")})
	assert.Equal(t, internalBefore+1, testutil.ToFloat64(internal))
}
