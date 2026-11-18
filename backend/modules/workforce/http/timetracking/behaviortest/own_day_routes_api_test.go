// Router-level flow through the staff member's own time-tracking routes
// under their production path, with the real capabilities.
package behaviortest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
	timetracking "github.com/moto-ogs/project-phoenix/modules/workforce/http/timetracking"
	"github.com/moto-ogs/project-phoenix/modules/workforce/workforcetest"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type ownDayFederalState struct{}

func (ownDayFederalState) ResolveString(context.Context, string) (string, error) { return "DE-NW", nil }

func setupOwnDayRouter(t *testing.T) (chi.Router, *bun.DB) {
	t.Helper()
	clock := func() time.Time { return ownAllowancesNow }
	db, capabilities := workforcetest.ComposeAdmin(t, clock)
	schoolCalendar, err := api.NewSchoolCalendarWithAdministration(testpkg.NewDatabase(t, db), ownDayFederalState{}, func(context.Context) error { return nil }, nil)
	require.NoError(t, err)
	resource := timetracking.NewResource(timetracking.Dependencies{
		WorkSessions:  capabilities.WorkSessions,
		StaffAbsences: capabilities.StaffAbsences,
		AbsenceWrites: capabilities.AbsenceWrites,
		Staff:         capabilities.Staff,
		WorkTimeMonth: capabilities.WorkTimeMonth,
		Calendar:      api.PlanningCalendarCapability(schoolCalendar),
		Allowances:    newWorkforceCapability(t, db, clock),
		AllowanceResponses: func(accounts []workforce.AbsenceTypeAllowanceAccount) any {
			return absencetypes.ToOwnAllowanceResponses(accounts)
		},
		AccountStartDate: func(context.Context) (string, error) { return "2026-08-01", nil },
		Identity:         testIdentity,
		WithinTenant:     testWithinTenant(db),
		Today:            capabilities.Today,
	})
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/time-tracking", resource.Router(timetracking.ScopeTestTenantRoutes(testpkg.TenantSessionGatesWithCaches(scopeTestSettingsCache))))
	return router, db
}

func TestOwnTimeTrackingDay_StampsBreaksAbsencesAndVacationThroughTheRoutes(t *testing.T) {
	t.Parallel()
	router, db := setupOwnDayRouter(t)
	staff, account := testpkg.CreateTestStaffWithAccount(t, db, "Tessa", "Tag")
	token := ownToken(t, account.ID, 0, "time_tracking:own")
	do := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		var reader bytes.Buffer
		if body != nil {
			require.NoError(t, json.NewEncoder(&reader).Encode(body))
		}
		req := httptest.NewRequest(method, "/api/time-tracking"+path, &reader)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, want, rec.Code, "%s %s: %s", method, path, rec.Body.String())
		if rec.Body.Len() == 0 {
			return nil
		}
		var envelope struct {
			Data any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
		if list, ok := envelope.Data.([]any); ok {
			return map[string]any{"list": list}
		}
		object, _ := envelope.Data.(map[string]any)
		return object
	}
	staffID := fmt.Sprint(staff.ID)

	session := do(http.MethodPost, "/check-in", map[string]any{"status": "present"}, http.StatusOK)
	assert.Equal(t, staffID, session["staff_id"], "the block belongs to the caller, its id travels as a string")
	assert.Equal(t, "present", session["status"])
	started := do(http.MethodPost, "/break/start", map[string]any{"planned_duration_minutes": 30}, http.StatusOK)
	assert.Equal(t, session["id"], started["session_id"])
	ended := do(http.MethodPost, "/break/end", nil, http.StatusOK)
	assert.Equal(t, session["id"], ended["id"])
	noted := do(http.MethodPut, fmt.Sprintf("/%v", session["id"]), map[string]any{"notes": "Elterngespräch"}, http.StatusOK)
	assert.Equal(t, "Elterngespräch", noted["notes"])

	history := do(http.MethodGet, "/history?from=2026-08-24&to=2026-08-24", nil, http.StatusOK)
	blocks, _ := history["sessions"].([]any)
	require.Len(t, blocks, 1)
	block, _ := blocks[0].(map[string]any)
	assert.Equal(t, session["id"], block["id"])
	assert.Len(t, block["breaks"], 1)

	assert.Equal(t, "2026-08-01", do(http.MethodGet, "/config", nil, http.StatusOK)["account_start_date"])
	holidays := do(http.MethodGet, "/holidays?from=2026-05-01&to=2026-05-31", nil, http.StatusOK)["list"]
	assert.Contains(t, fmt.Sprint(holidays), "2026-05-01", "Tag der Arbeit is a holiday in Nordrhein-Westfalen")

	absence := do(http.MethodPost, "/absences", map[string]any{"absence_type": "sick", "date_start": "2026-08-25", "date_end": "2026-08-25"}, http.StatusCreated)
	assert.Equal(t, staffID, fmt.Sprint(absence["staff_id"]))
	absencePath := fmt.Sprintf("/absences/%v", absence["id"])
	longer := do(http.MethodPut, absencePath, map[string]any{"date_end": "2026-08-26"}, http.StatusOK)
	assert.Equal(t, "2026-08-26", longer["date_end"])
	do(http.MethodDelete, absencePath, nil, http.StatusNoContent)
	listed := do(http.MethodGet, "/absences?from=2026-08-01&to=2026-08-31", nil, http.StatusOK)["list"]
	assert.Empty(t, listed, "the deleted absence is gone")

	vacation := do(http.MethodPost, "/vacation/request", map[string]any{"date_start": "2026-09-07", "date_end": "2026-09-08"}, http.StatusCreated)
	assert.Equal(t, "vacation", vacation["absence_type"])
	quota := do(http.MethodGet, "/vacation/quota?year=2026", nil, http.StatusOK)
	assert.Equal(t, staffID, fmt.Sprint(quota["staff_id"]))
}
