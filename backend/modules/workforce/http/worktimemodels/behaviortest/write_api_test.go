//go:build testhooks

package worktimemodels_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type writtenModel struct {
	ID             testpkg.ID `json:"id"`
	Name           string     `json:"name"`
	RotationLength int        `json:"rotation_length"`
	Anchor         string     `json:"rotation_anchor_date"`
	Entries        []struct {
		DayOfWeek     int     `json:"day_of_week"`
		TargetMinutes int     `json:"target_minutes"`
		StartTime     *string `json:"start_time"`
	} `json:"entries"`
	WeeklyTotals []int  `json:"weekly_totals"`
	Version      string `json:"version"`
}

// A template is created, rewritten and deleted through the routes, and every
// answer shows what the capability stored.
func TestWorkTimeModelIsCreatedRewrittenAndDeletedThroughTheRoutes(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	h := newAssignmentHarness(t, db)
	body := func(name string, minutes int, version ...string) map[string]any {
		expected := ""
		if len(version) > 0 {
			expected = version[0]
		}
		return map[string]any{
			"name": name, "rotation_length": 1, "rotation_anchor_date": "2026-10-12", "expected_version": expected,
			"entries": []map[string]any{
				{"week_index": 0, "day_of_week": 0, "target_minutes": minutes, "start_time": "08:30"},
				{"week_index": 0, "day_of_week": 1, "target_minutes": 0},
			},
		}
	}

	status, data, _ := h.request(http.MethodPost, "/", body("Vorlage anlegen", 300))
	require.Equal(t, http.StatusCreated, status, string(data))
	var created writtenModel
	require.NoError(t, json.Unmarshal(data, &created))
	testpkg.OwnTestWorkTimeModel(t, db, int64(created.ID))
	assert.Equal(t, "Vorlage anlegen", created.Name)
	assert.Equal(t, "2026-10-12", created.Anchor)
	assert.Equal(t, []int{300}, created.WeeklyTotals)
	require.Len(t, created.Entries, 1, "the zero-minute day is no entry")
	require.NotNil(t, created.Entries[0].StartTime)
	assert.Equal(t, "08:30", *created.Entries[0].StartTime)

	status, data, _ = h.request(http.MethodPut, fmt.Sprintf("/%d", created.ID), body("Vorlage geändert", 240, created.Version))
	require.Equal(t, http.StatusOK, status, string(data))
	var updated writtenModel
	require.NoError(t, json.Unmarshal(data, &updated))
	assert.Equal(t, created.ID, updated.ID)
	assert.Equal(t, []int{240}, updated.WeeklyTotals)
	assert.Equal(t, 1, h.notified, "a rewritten template refreshes the time-account views once")
	stored, err := h.models.FindWorkTimeModel(testpkg.Ctx(t), int64(created.ID))
	require.NoError(t, err)
	assert.Equal(t, "Vorlage geändert", stored.Name)

	// ADR 0311: an edit from the form read before that rewrite, or one
	// without a version, is refused and writes nothing; the answer's
	// version saves again.
	for name, version := range map[string]string{"outdated": created.Version, "missing": ""} {
		status, _, code := h.request(http.MethodPut, fmt.Sprintf("/%d", created.ID), body("Überschrieben", 60, version))
		require.Equal(t, http.StatusConflict, status, name)
		assert.Equal(t, "general.changed_since_read", code, name)
	}
	stored, err = h.models.FindWorkTimeModel(testpkg.Ctx(t), int64(created.ID))
	require.NoError(t, err)
	assert.Equal(t, "Vorlage geändert", stored.Name, "a refused edit writes nothing")
	status, data, _ = h.request(http.MethodPut, fmt.Sprintf("/%d", created.ID), body("Vorlage wieder", 120, updated.Version))
	require.Equal(t, http.StatusOK, status, string(data))

	status, data, _ = h.request(http.MethodDelete, fmt.Sprintf("/%d", created.ID), nil)
	require.Equal(t, http.StatusOK, status, string(data))
	var deleted struct {
		ID testpkg.ID `json:"id"`
	}
	require.NoError(t, json.Unmarshal(data, &deleted))
	assert.Equal(t, created.ID, deleted.ID)
	_, err = h.models.FindWorkTimeModel(testpkg.Ctx(t), int64(created.ID))
	require.ErrorIs(t, err, workforce.ErrWorkTimeModelNotFound)
}
