package timetablehttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A committed create whose enriched re-read failed still answers 201 in the
// registered answer type: the block's own fields, the warning, and every
// enriched field at its empty value. A client that retries after an error
// would plan the block twice.
func TestCreatedWithoutEnrichmentAnswersTheRegisteredType(t *testing.T) {
	t.Parallel()
	recorder := httptest.NewRecorder()
	respondCreatedWithoutEnrichment(recorder, httptest.NewRequest(http.MethodPost, "/api/timetable/instances/", nil), &timetable.LifecycleInstance{
		ID: 41, Date: calendar.NewDate(2026, time.November, 18),
		StartTime: time.Date(0, 1, 1, 13, 30, 0, 0, time.UTC), EndTime: time.Date(0, 1, 1, 14, 15, 0, 0, time.UTC),
		Title: "Hausaufgaben", Status: "planned", RoomID: 7,
	}, errors.New("read failed"))

	require.Equal(t, http.StatusCreated, recorder.Code, recorder.Body.String())
	var answer struct {
		Data map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	for key, want := range map[string]any{
		"id": float64(41), "date": "2026-11-18", "start_time": "13:30", "end_time": "14:15",
		"title": "Hausaufgaben", "status": "planned", "is_spontaneous": false, "room_id": float64(7),
		"enrich_warning": "enrichment failed: read failed",
	} {
		assert.Equal(t, want, answer.Data[key], key)
	}
	assert.Equal(t, []any{}, answer.Data["staff"], "a list of the registered type is never null")
	assert.Equal(t, []any{}, answer.Data["students"])
	assert.Equal(t, []any{}, answer.Data["student_ids"])
}
