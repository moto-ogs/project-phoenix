package timetablehttp_test

// Der Schließtag weckt offene Seiten seiner Schule (#7664): Anlegen, Ändern
// und Löschen über die Routen der Leitung senden nach dem Commit das
// inhaltslose staffing_deviation_changed, auf das „Heute anders“ neu lädt.
// Eine abgelehnte Eingabe sendet nichts.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	timetablehttp "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// closingDaySignals records the change signals of the closing day routes.
type closingDaySignals struct {
	mu    sync.Mutex
	calls []string
}

func (s *closingDaySignals) AnnounceStaffingChanged(tenantID int64, source string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, fmt.Sprintf("%d:%s", tenantID, source))
	return nil
}

func (s *closingDaySignals) taken() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	calls := s.calls
	s.calls = nil
	return calls
}

func TestClosingDayWritesWakeTheSchoolsOpenPages(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	database := testpkg.NewDatabase(t, db)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	days, err := api.NewSchoolCalendarWithClosingDayNotices(database, settings.Settings, owners.DeliveryNotifications{}, closingFeedToday)
	require.NoError(t, err)
	signals := &closingDaySignals{}
	router := timetablehttp.NewResource(timetablehttp.Dependencies{
		ClosingDays: days, SettingsService: settings.Settings, Staffing: signals,
		Now: func() time.Time { return time.Date(2030, time.June, 10, 10, 0, 0, 0, time.UTC) },
	}).Router(api.ProtectedTenantRoutes)
	account := testpkg.CreateTestAccount(t, db, "closing-signal")
	signal := []string{fmt.Sprintf("%d:closing_days", tenantID)}

	rec := sendClosingDay(t, router, http.MethodPost, "/closing-days", account.ID, tenantID,
		map[string]string{"start_date": "2030-06-12", "end_date": "2030-06-12", "reason": "Pädagogischer Tag"}, "schedules:create")
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	assert.Equal(t, signal, signals.taken(), "a new closing day")
	var created struct {
		Data struct {
			ID testpkg.ID `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	path := fmt.Sprintf("/closing-days/%d", created.Data.ID)

	rec = sendClosingDay(t, router, http.MethodPut, path, account.ID, tenantID,
		map[string]string{"start_date": "2030-06-12", "end_date": "2030-06-13", "reason": "Pädagogische Tage"}, "schedules:update")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, signal, signals.taken(), "a changed closing day")

	rec = sendClosingDay(t, router, http.MethodPost, "/closing-days", account.ID, tenantID,
		map[string]string{"start_date": "2030-06-12", "end_date": "2030-06-12", "reason": ""}, "schedules:create")
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Empty(t, signals.taken(), "a refused closing day changes nothing")

	rec = sendClosingDay(t, router, http.MethodDelete, path, account.ID, tenantID, nil, "schedules:delete")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, signal, signals.taken(), "a deleted closing day")
}

func sendClosingDay(t *testing.T, router chi.Router, method, path string, accountID, tenantID int64, payload any, perms ...string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	if payload != nil {
		require.NoError(t, json.NewEncoder(&body).Encode(payload))
	}
	req := httptest.NewRequest(method, path, &body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(accountID), tenantID, perms...)))
	return testutil.ExecuteRequestForTest(t, router, req)
}
