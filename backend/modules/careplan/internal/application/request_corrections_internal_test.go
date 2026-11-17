package application

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	"github.com/stretchr/testify/assert"
)

// A ledger entry with a version compares the row for equality; one written
// before versions existed keeps the stamp comparison.
func TestChangedAfterDecisionPrefersRecordedVersion(t *testing.T) {
	t.Parallel()
	decided := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	request := &carerequests.Request{ReviewedAt: &decided, UpdatedAt: decided}
	earlier, later := decided.Add(-time.Second), decided.Add(time.Second)

	assert.True(t, changedAfterDecision(request, "v1", "v2", earlier), "an older stamp with another version is a change")
	assert.False(t, changedAfterDecision(request, "v1", "v1", later), "an equal version is no change")
	assert.True(t, changedAfterDecision(request, "", "v2", later), "legacy: a later stamp is a change")
	assert.False(t, changedAfterDecision(request, "", "v2", earlier), "legacy: an older stamp is not")
}

func TestLatestPickupRowsReadsVersions(t *testing.T) {
	t.Parallel()
	applied, found := latestPickupRows([]ports.RequestCorrectionEvent{{Type: "decided", Payload: map[string]any{
		"pickup_exception_id": float64(3), "pickup_exception_version": "a",
		"departure_exception_id": float64(4), "pickup_note_id": float64(5),
	}}})
	assert.True(t, found)
	assert.Equal(t, carerequests.PickupApplied{PickupExceptionID: 3, PickupExceptionVersion: "a", DepartureExceptionID: 4, PickupNoteID: 5}, applied)
}
