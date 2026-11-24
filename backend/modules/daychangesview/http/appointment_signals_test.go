package daychangesviewhttp_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// sendCalendar sends one request to the calendar routes and returns the id of
// the appointment it answers with, if any.
func sendCalendar(t *testing.T, router chi.Router, method, path, token string, payload any) string {
	t.Helper()
	body := []byte{}
	if payload != nil {
		raw, err := json.Marshal(payload)
		require.NoError(t, err)
		body = raw
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := testutil.ExecuteRequestForTest(t, router, req)
	require.Less(t, rec.Code, 300, rec.Body.String())
	var envelope struct {
		Data struct {
			Appointment struct {
				ID testpkg.ID `json:"id"`
			} `json:"appointment"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &envelope)
	return strconv.FormatInt(int64(envelope.Data.Appointment.ID), 10)
}

// TestDayChangesAppointmentSignal (#7693): every appointment write over the
// calendar routes wakes „Heute anders“ and the own calendar of the school's
// staff sessions after its commit, without content; another school's
// sessions get nothing. A refused write sends no signal.
func TestDayChangesAppointmentSignal(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	var otherSchool int64
	t.Run("other school", func(t *testing.T) { otherSchool = testpkg.OwnTenant(t) })
	calendarRoutes, signals, err := api.NewDayChangesCalendarTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), tenantID, otherSchool)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/calendar", calendarRoutes)

	_, organizerAccount := testpkg.CreateTestCalendarStaff(t, db, "Olga", "Organisiert")
	invited, invitedAccount := testpkg.CreateTestCalendarStaff(t, db, "Anna", "Eingeladen")
	claims := testutil.TenantUserTestClaims(int(organizerAccount.ID), tenantID, permissions.CalendarManage, permissions.CalendarOwn)
	manage := testutil.MintTestJWT(t, claims)
	create := func(title string, recurrence map[string]any) string {
		payload := map[string]any{
			"title": title, "start_date": "2026-05-04", "end_date": "2026-05-04", "start_time": "14:00", "end_time": "15:00",
			"delivery_mode": "informational", "targets": []map[string]any{{"type": "staff", "id": testpkg.ID(invited.ID)}},
		}
		if recurrence != nil {
			payload["recurrence"] = recurrence
		}
		return "/api/calendar/appointments/" + sendCalendar(t, router, http.MethodPost, "/api/calendar/appointments", manage, payload)
	}

	evening := create("Elternabend", nil)
	series := create("Wöchentliche AG", map[string]any{"frequency": "weekly", "interval_count": 1, "weekdays": []string{"monday"}, "ends_on": "2026-05-25"})
	own, other, content := signals()
	assert.Equal(t, 2, own, "each new appointment wakes the school's staff sessions")

	sendCalendar(t, router, http.MethodPost, evening+"/cancel", manage, nil)
	cancelled, otherCancelled, cancelContent := signals()
	assert.Equal(t, 1, cancelled, "cancelling an appointment wakes them after the commit")

	sendCalendar(t, router, http.MethodPost, series+"/occurrences/2026-05-11/cancel", manage, nil)
	occurrence, otherOccurrence, occurrenceContent := signals()
	assert.Equal(t, 1, occurrence, "cancelling one date of a series wakes them")

	assert.Zero(t, other+otherCancelled+otherOccurrence, "another school's sessions get nothing")
	assert.False(t, content || cancelContent || occurrenceContent, "the signal carries no content")

	t.Run("a refused write sends nothing", func(t *testing.T) {
		guest := testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(invitedAccount.ID), tenantID, permissions.CalendarManage, permissions.CalendarOwn))
		req := httptest.NewRequest(http.MethodPost, series+"/cancel", nil)
		req.Header.Set("Authorization", "Bearer "+guest)
		rec := testutil.ExecuteRequestForTest(t, router, req)
		require.GreaterOrEqual(t, rec.Code, 400, "only the organizer cancels")
		refused, _, _ := signals()
		assert.Zero(t, refused)
	})
}
