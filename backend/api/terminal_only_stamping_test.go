package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// checkTerminalOnlyStamping drives terminal-only stamping (#8024) through the
// production router: the school's switch, the leadership exemption read from
// the roles in the database, every app stamp, the self-edit of recorded
// times, the clock overview and the isolation from another school.
func checkTerminalOnlyStamping(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	testpkg.SetTestTenantSetting(t, db, school, records.KeyModuleZeiterfassung, "true")

	caregiver, caregiverAccount := testpkg.CreateTestCalendarStaff(t, db, "Terminal", "Caregiver")
	_, leadAccount := testpkg.CreateTestCalendarStaff(t, db, "Terminal", "Lead")
	// The lead holds the caregiver role and a managing role: one suffices.
	testpkg.GrantTestPermission(t, db, school, leadAccount.ID, permissions.TimeTrackingManage)
	caregiverToken := testpkg.MintLiveSessionJWT(t, db, testpkg.TenantUserTestClaims(int(caregiverAccount.ID), school, permissions.TimeTrackingOwn))
	leadToken := testpkg.MintLiveSessionJWT(t, db, testpkg.TenantUserTestClaims(int(leadAccount.ID), school, permissions.TimeTrackingOwn, permissions.TimeTrackingManage))

	send := func(method, path, body, token string) *httptest.ResponseRecorder {
		return checkpointRequest(api, checkpointScenario{Method: method, Path: ownTimePath + path, Authenticated: true, Body: body}, token)
	}
	refused := func(rec *httptest.ResponseRecorder, code string) {
		t.Helper()
		require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		var problem struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &problem))
		require.Equal(t, code, problem.Code)
	}
	terminalOnly := func(token string) bool {
		t.Helper()
		rec := send(http.MethodGet, "overview", "", token)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var overview struct {
			Data struct {
				TerminalOnlyStamping *bool `json:"terminal_only_stamping"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &overview))
		require.NotNil(t, overview.Data.TerminalOnlyStamping)
		return *overview.Data.TerminalOnlyStamping
	}
	sessions := func() int {
		t.Helper()
		var count int
		require.NoError(t, db.NewRaw("SELECT count(*) FROM active.work_sessions WHERE staff_id = ?", caregiver.ID).Scan(testpkg.Ctx(t), &count))
		return count
	}
	const checkIn = `{"status":"present"}`

	// Default off: the app stamps as before.
	require.False(t, terminalOnly(caregiverToken))
	require.Equal(t, http.StatusOK, send(http.MethodPost, "check-in", checkIn, caregiverToken).Code)
	require.Equal(t, http.StatusOK, send(http.MethodPost, "break/start", "", caregiverToken).Code)
	require.Equal(t, http.StatusOK, send(http.MethodPost, "break/end", "", caregiverToken).Code)

	// Switched on while the block runs: the block stays, the app stamps stop.
	testpkg.SetTestTenantSetting(t, db, school, records.KeyTimeTrackingTerminalOnlyStamping, "true")
	require.True(t, terminalOnly(caregiverToken))
	require.False(t, terminalOnly(leadToken))
	require.Equal(t, 1, sessions())
	refused(send(http.MethodPost, "break/start", "", caregiverToken), "workforce.terminal_only_stamping")
	refused(send(http.MethodPost, "break/end", "", caregiverToken), "workforce.terminal_only_stamping")
	refused(send(http.MethodPost, "check-out", "", caregiverToken), "workforce.terminal_only_stamping")
	var open int
	require.NoError(t, db.NewRaw("SELECT count(*) FROM active.work_sessions WHERE staff_id = ? AND check_out_time IS NULL", caregiver.ID).Scan(testpkg.Ctx(t), &open))
	require.Equal(t, 1, open, "the running block is untouched")

	// The leadership closes it; a new app check-in is refused, and no request
	// field moves the stamp onto the terminal's channel.
	_, err := db.NewRaw("UPDATE active.work_sessions SET check_in_time = check_in_time - interval '2 minutes', check_out_time = check_in_time - interval '1 minute' WHERE staff_id = ?", caregiver.ID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	refused(send(http.MethodPost, "check-in", `{"status":"present","source":"nfc"}`, caregiverToken), "workforce.terminal_only_stamping")
	require.Equal(t, 1, sessions())

	// Own recorded times cannot be moved, with or without a reason.
	var sessionID int64
	require.NoError(t, db.NewRaw("SELECT id FROM active.work_sessions WHERE staff_id = ?", caregiver.ID).Scan(testpkg.Ctx(t), &sessionID))
	later := testpkg.DatabaseNow(t, db).Add(-30 * time.Second).UTC().Format(time.RFC3339)
	refused(send(http.MethodPut, strconv.FormatInt(sessionID, 10), `{"check_out_time":"`+later+`","notes":"vergessen"}`, caregiverToken),
		"workforce.terminal_only_time_edit")

	// The other own views stay.
	today := calendar.DateFromTime(testpkg.DatabaseNow(t, db))
	require.Equal(t, http.StatusOK, send(http.MethodGet, "history"+ownTimeRange(today, today), "", caregiverToken).Code)
	require.Equal(t, http.StatusOK, send(http.MethodGet, "absences"+ownTimeRange(today, today), "", caregiverToken).Code)

	// The leadership keeps the app.
	require.Equal(t, http.StatusOK, send(http.MethodPost, "check-in", checkIn, leadToken).Code)
	require.Equal(t, http.StatusOK, send(http.MethodPost, "check-out", "", leadToken).Code)

	// Another school's switch is its own: off there, the app stamps.
	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	testpkg.SetTestTenantSetting(t, db, otherSchool, records.KeyModuleZeiterfassung, "true")
	_, otherAccount := testpkg.CreateTestStaffWithAccountForTenant(t, db, otherSchool, "Other", "Caregiver")
	otherToken := testpkg.MintLiveSessionJWT(t, db, testpkg.TenantUserTestClaims(int(otherAccount.ID), otherSchool, permissions.TimeTrackingOwn))
	require.Equal(t, http.StatusOK, send(http.MethodPost, "check-in", checkIn, otherToken).Code)

	// Without the NFC module there is no terminal: the switch stays inert.
	testpkg.SetTestTenantSetting(t, db, school, records.KeyModuleNFCAnwesenheit, "false")
	require.False(t, terminalOnly(caregiverToken))
	testpkg.SetTestTenantSetting(t, db, school, records.KeyModuleNFCAnwesenheit, "true")
	require.True(t, terminalOnly(caregiverToken))

	// Switched off again: the next request stamps in the app.
	testpkg.SetTestTenantSetting(t, db, school, records.KeyTimeTrackingTerminalOnlyStamping, "false")
	require.False(t, terminalOnly(caregiverToken))
	rec := send(http.MethodPost, "check-in", checkIn, caregiverToken)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}
