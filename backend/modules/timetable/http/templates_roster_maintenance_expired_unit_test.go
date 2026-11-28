package timetablehttp

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// TestRosterMaintenanceResponse_NamesExpiredSourcesWithSuccessor (#8203): a
// source of an ended phase travels with the suggested offering; without one
// the successor is absent, never an empty object.
func TestRosterMaintenanceResponse_NamesExpiredSourcesWithSuccessor(t *testing.T) {
	t.Parallel()

	body, err := json.Marshal(rosterMaintenanceResponse(timetable.TemplateRosterMaintenance{
		Mode:             "manual",
		InvalidOfferings: []timetable.OfferingRef{{ID: 7, Name: "Randstunde"}, {ID: 8, Name: "Ganztag"}},
		ExpiredOfferings: []timetable.ExpiredOfferingRef{
			{ID: 7, Name: "Randstunde", Successor: &timetable.OfferingRef{ID: 17, Name: "Randstunde"}},
			{ID: 8, Name: "Ganztag"},
		},
	}))
	require.NoError(t, err)
	// The response writer turns ids into strings; here they are still numbers.
	var wire struct {
		ExpiredOfferings []map[string]any `json:"expired_offerings"`
	}
	require.NoError(t, json.Unmarshal(body, &wire))
	assert.Equal(t, []map[string]any{
		{"id": float64(7), "name": "Randstunde", "successor": map[string]any{"id": float64(17), "name": "Randstunde"}},
		{"id": float64(8), "name": "Ganztag"},
	}, wire.ExpiredOfferings)
}
