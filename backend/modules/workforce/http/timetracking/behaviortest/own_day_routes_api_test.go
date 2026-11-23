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
	"sync/atomic"
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

// setupOwnDayRouter returns the router, its database and a hand that moves
// the pinned clock on, so a block can end after it began.
func setupOwnDayRouter(t *testing.T) (chi.Router, *bun.DB, func(time.Duration)) {
	t.Helper()
	var elapsed atomic.Int64
	clock := func() time.Time { return ownAllowancesNow.Add(time.Duration(elapsed.Load())) }
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
	return router, db, func(d time.Duration) { elapsed.Add(int64(d)) }
}

func TestOwnTimeTrackingDay_StampsBreaksAbsencesAndVacationThroughTheRoutes(t *testing.T) {
	t.Parallel()
	router, db, advance := setupOwnDayRouter(t)
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
	read := do(http.MethodGet, "/history?from=2026-08-24&to=2026-08-24", nil, http.StatusOK)
	encoded, encodeErr := json.Marshal(map[string]any{"data": read})
	require.NoError(t, encodeErr)
	version := historyVersion(t, encoded, fmt.Sprint(session["id"]))
	noted := do(http.MethodPut, fmt.Sprintf("/%v", session["id"]), map[string]any{"notes": "Elterngespräch", "expected_version": version}, http.StatusOK)
	assert.Equal(t, "Elterngespräch", noted["notes"])
	// A second correction from the same read, or one without a read, is
	// refused and writes nothing (ADR 0311): the block changed since.
	for _, stale := range []string{version, ""} {
		var body bytes.Buffer
		require.NoError(t, json.NewEncoder(&body).Encode(map[string]any{"notes": "Überschrieben", "expected_version": stale}))
		req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/time-tracking/%v", session["id"]), &body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusConflict, rec.Code, "token %q: %s", stale, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "general.changed_since_read")
	}
	var storedNotes string
	require.NoError(t, db.NewRaw(`SELECT notes FROM active.work_sessions WHERE id = ?`, session["id"]).Scan(t.Context(), &storedNotes))
	assert.Equal(t, "Elterngespräch", storedNotes, "the refused corrections change nothing")
	advance(4 * time.Hour)
	left := do(http.MethodPost, "/check-out", nil, http.StatusOK)
	assert.Equal(t, session["id"], left["id"])
	assert.NotNil(t, left["check_out_time"], "the check-out closes the block")

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

	// A Rückfrage on the request is answered with a new note (#1419), then
	// the request is withdrawn.
	vacationPath := fmt.Sprintf("/absences/%v", vacation["id"])
	_, err := db.NewUpdate().Table("active.staff_absences").Set("status = ?", "question").
		Where("id = ?", vacation["id"]).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	resubmitted := do(http.MethodPost, vacationPath+"/resubmit", map[string]any{"note": "Vertretung steht"}, http.StatusOK)
	assert.Equal(t, "requested", resubmitted["status"])
	assert.Equal(t, "Vertretung steht", resubmitted["note"])
	do(http.MethodPost, vacationPath+"/cancel", nil, http.StatusNoContent)
	var status string
	require.NoError(t, db.NewSelect().Table("active.staff_absences").Column("status").
		Where("id = ?", vacation["id"]).Scan(testpkg.Ctx(t), &status))
	assert.Equal(t, "canceled", status)
}
