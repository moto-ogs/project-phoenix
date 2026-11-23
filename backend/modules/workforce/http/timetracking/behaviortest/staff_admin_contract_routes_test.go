package behaviortest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// These routes reach the browser through the catalog proxy (#2352); each test
// drives them under their production path /api/staff: the mounted router
// puts /api in front of each request path.

func decodeContractData[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	return envelope.Data
}

// The Leitung enters a forgotten block and corrects its note; both answers
// carry the identifiers as decimal strings, and the correction is stored.
func TestAdminSessionWritesAnswerWithTheStoredBlock(t *testing.T) {
	t.Parallel()
	ctx := setupOverviewAPI(t)
	setAccountStart(t, ctx.tc, "2026-01-01")
	ctx.tc.router = testpkg.MountedQueryBudgetRouter("/api", ctx.tc.router)
	target := testpkg.CreateTestStaff(t, ctx.tc.db, "Nachtrag", fmt.Sprintf("Ziel-%d", testpkg.UniqueSuffix()))
	sessions := fmt.Sprintf("/staff/%d/time-tracking/sessions", target.ID)

	type block struct {
		ID        string `json:"id"`
		StaffID   string `json:"staff_id"`
		CreatedBy string `json:"created_by"`
		UpdatedBy string `json:"updated_by"`
		Date      string `json:"date"`
		Notes     string `json:"notes"`
	}
	rec := ctx.post(sessions, `{"date":"2026-03-10T00:00:00Z","check_in_time":"2026-03-10T07:00:00Z",`+
		`"check_out_time":"2026-03-10T12:00:00Z","break_minutes":0,"status":"present","notes":"Stempeln vergessen"}`, "time_tracking:manage")
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeContractData[block](t, rec)
	assert.Equal(t, strconv.FormatInt(target.ID, 10), created.StaffID)
	assert.Equal(t, strconv.FormatInt(ctx.staffID, 10), created.CreatedBy)
	assert.Equal(t, "2026-03-10", created.Date)
	require.NotEmpty(t, created.ID)

	history := fmt.Sprintf("/staff/%d/time-tracking/history?from=2026-03-10&to=2026-03-10", target.ID)
	rec = ctx.get(history, "time_tracking:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	read := historyVersion(t, rec.Body.Bytes(), created.ID)
	rec = ctx.put(sessions+"/"+created.ID, withExpectedVersion(t, `{"notes":"Nachgetragen laut Dienstbuch"}`, read), "time_tracking:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	// A second correction from the same read is refused and writes nothing
	// (ADR 0311); the block changed since.
	stale := ctx.put(sessions+"/"+created.ID, withExpectedVersion(t, `{"notes":"Überschrieben"}`, read), "time_tracking:manage")
	require.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	assert.Contains(t, stale.Body.String(), "general.changed_since_read")
	var stored string
	require.NoError(t, ctx.tc.db.NewRaw(`SELECT notes FROM active.work_sessions WHERE id = ?`, created.ID).Scan(t.Context(), &stored))
	assert.Equal(t, "Nachgetragen laut Dienstbuch", stored, "the refused correction leaves the stored note")
	updated := decodeContractData[block](t, rec)
	assert.Equal(t, created.ID, updated.ID)
	assert.Equal(t, "Nachgetragen laut Dienstbuch", updated.Notes)
	assert.Equal(t, strconv.FormatInt(ctx.staffID, 10), updated.UpdatedBy)
}

// /payroll changes and archives a wage type and a surcharge rule and books a
// school absence type onto a wage type; the overview shows each change.
func TestPayrollRuleChangesAnswerUnderTheProductionPath(t *testing.T) {
	t.Parallel()
	ctx := setupOverviewAPI(t)
	ctx.tc.router = testpkg.MountedQueryBudgetRouter("/api", ctx.tc.router)
	const rules = payrollRulesPath
	type entity struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		RateHundredths int    `json:"rate_hundredths"`
	}
	create := func(path, body string) entity {
		t.Helper()
		rec := ctx.post(rules+path, body, "config:manage")
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		return decodeContractData[entity](t, rec)
	}
	send := func(method, path, body string) {
		t.Helper()
		var rec *httptest.ResponseRecorder
		if method == http.MethodPut {
			rec = ctx.put(rules+path, body, "config:manage")
		} else {
			rec = ctx.do(httptest.NewRequest(method, rules+path, nil), "config:manage")
		}
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	overview := func() string {
		t.Helper()
		rec := ctx.get(rules, "config:manage")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return rec.Body.String()
	}

	night := create("/wage-types", `{"name":"Nachtzuschlag","number":"310","unit":"stunden"}`)
	rec := ctx.put(rules+"/wage-types/"+night.ID, `{"name":"Nachtarbeit","number":"311","unit":"stunden"}`, "config:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "Nachtarbeit", decodeContractData[entity](t, rec).Name)

	rule := create("/surcharge-rules", fmt.Sprintf(`{"kind":"sonntag","rate_type":"prozent","rate_hundredths":2500,"wage_type_id":%q}`, night.ID))
	rec = ctx.put(rules+"/surcharge-rules/"+rule.ID, fmt.Sprintf(`{"kind":"sonntag","rate_type":"prozent","rate_hundredths":5000,"wage_type_id":%q}`, night.ID), "config:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, 5000, decodeContractData[entity](t, rec).RateHundredths)

	absenceType := testpkg.CreateTestStaffAbsenceType(t, ctx.tc.db, fmt.Sprintf("Fortbildung-%d", testpkg.UniqueSuffix()))
	send(http.MethodPut, fmt.Sprintf("/absence-types/%d", absenceType.ID), fmt.Sprintf(`{"wage_type_id":%q}`, night.ID))
	assert.Contains(t, overview(), fmt.Sprintf(`"id":"%d","name":%q,"is_active":true,"wage_type_id":%q`, absenceType.ID, absenceType.Name, night.ID))

	send(http.MethodPut, fmt.Sprintf("/absence-types/%d", absenceType.ID), `{"wage_type_id":null}`)
	send(http.MethodDelete, "/surcharge-rules/"+rule.ID, "")
	send(http.MethodDelete, "/wage-types/"+night.ID, "")
	var after struct {
		Data struct {
			WageTypes      []entity `json:"wage_types"`
			SurchargeRules []entity `json:"surcharge_rules"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(overview()), &after))
	assert.Empty(t, after.Data.SurchargeRules, "an archived rule leaves the overview")
	assert.Empty(t, after.Data.WageTypes, "an archived wage type leaves the overview")
}

// The month close names the staff the Träger closes, the Lohnbüro block reads
// the newest dispatch, and the Nachweise tab reads the Träger's proofs.
func TestPayrollAndProofReadsAnswerUnderTheProductionPath(t *testing.T) {
	t.Parallel()
	ctx := setupOverviewAPI(t)
	ctx.tc.router = testpkg.MountedQueryBudgetRouter("/api", ctx.tc.router)

	rec := ctx.get("/staff/time-tracking/month-close/traeger-staff?year=2026&month=3", "time_tracking:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	month := decodeContractData[struct {
		Year     int      `json:"year"`
		Month    int      `json:"month"`
		StaffIDs []string `json:"staff_ids"`
	}](t, rec)
	assert.Equal(t, 2026, month.Year)
	assert.Equal(t, 3, month.Month)
	assert.Empty(t, month.StaffIDs, "no contract of a Träger covers the school's staff")

	rec = ctx.get("/staff/time-tracking/payroll-dispatch", "config:manage")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.JSONEq(t, `{"latest":null}`, string(decodeContractData[json.RawMessage](t, rec)), "a school without the automatic send has no dispatch")

	rec = ctx.get(fmt.Sprintf("/staff/%d/traeger-proofs", ctx.staffID), "staff:stammdaten")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, decodeContractData[[]json.RawMessage](t, rec), "the Träger keeps no proofs for this person")
}
