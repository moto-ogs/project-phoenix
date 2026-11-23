package parent

import (
	"encoding/json"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The identifiers of an enrollable phase were strings before they became
// ident.ID; the wire must not notice the change of type.
func TestEnrollablePhaseKeepsItsIdentifiersAsStrings(t *testing.T) {
	t.Parallel()
	rendered, err := wire.Marshal(EnrollablePhaseResponse{SchoolID: 9223372036854775807, PhaseID: 12, ServiceStartDate: "2026-08-01"})
	require.NoError(t, err)
	var wire map[string]any
	require.NoError(t, json.Unmarshal(rendered, &wire))
	assert.Equal(t, "9223372036854775807", wire["school_id"])
	assert.Equal(t, "12", wire["phase_id"])
	assert.Equal(t, "2026-08-01", wire["service_start_date"])
	assert.NotContains(t, wire, "enrollment_open_at")
}
