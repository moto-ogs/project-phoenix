package behaviortest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/workforce/http/timetracking"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// sollKeep keeps the Soll of the listed employments for the Träger, as a
// running contract of the Träger does (#4706).
type sollKeep struct{ staffIDs []int64 }

func (k sollKeep) StaffKeptByTraeger(context.Context, int64) (bool, error) { return false, nil }

func (k sollKeep) StaffSollKeptByTraeger(_ context.Context, staffID int64) (bool, error) {
	return slices.Contains(k.staffIDs, staffID), nil
}

// TestTraegerSollIsReadOnlyForTheSchool pins ADR 0089 section 6 for the Soll:
// while a contract of the Träger governs it, the school reads the schedule
// with „führt der Träger“ and changes neither the schedule nor a
// Sonderarbeitszeit; everybody else stays with the school.
func TestTraegerSollIsReadOnlyForTheSchool(t *testing.T) {
	t.Parallel()
	keep := &sollKeep{}
	ctx := setupOverviewAPIWith(t, func(_ *bun.DB, deps *timetracking.StaffAdminDependencies) { deps.TraegerKeep = keep })
	kept := testpkg.CreateTestStaff(t, ctx.tc.db, "Mira", "Vertrag")
	own := testpkg.CreateTestStaff(t, ctx.tc.db, "Jonas", "Schule")
	keep.staffIDs = []int64{kept.ID}

	rec := ctx.get(fmt.Sprintf("/staff/%d/schedule", kept.ID), "time_tracking:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var schedule struct {
		Data struct {
			KeptByTraeger bool `json:"kept_by_traeger"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &schedule))
	assert.True(t, schedule.Data.KeptByTraeger)

	body := `{"mode":"custom","rotation_length":1,"entries":[{"week_index":0,"day_of_week":0,"target_minutes":60}]}`
	for name, rec := range map[string]func() int{
		"schedule": func() int {
			return ctx.put(fmt.Sprintf("/staff/%d/schedule", kept.ID), body, "time_tracking:manage").Code
		},
		"Sonderarbeitszeit": func() int {
			return ctx.post(overridesPath(kept.ID), overrideBody("2026-12-21", "2026-12-23", 0), "time_tracking:manage").Code
		},
		"delete": func() int { return ctx.deleteOverride(t, overridesPath(kept.ID)+"/1").Code },
	} {
		assert.Equal(t, http.StatusConflict, rec(), name)
	}
	refusal := ctx.post(overridesPath(kept.ID), overrideBody("2026-12-21", "2026-12-23", 0), "time_tracking:manage")
	var envelope struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(refusal.Body.Bytes(), &envelope))
	assert.Equal(t, "workforce.staff_soll_kept_by_traeger", envelope.Code)

	rec = ctx.post(overridesPath(own.ID), overrideBody("2026-12-21", "2026-12-23", 0), "time_tracking:manage")
	assert.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
}
