package calendar_e2e_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	rootAPI "github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	calendarHTTP "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type schoolCalendarE2EResponse struct {
	Data struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Events []struct {
			Title         string  `json:"title"`
			AppointmentID *string `json:"appointment_id"`
			Version       string  `json:"version"`
		} `json:"events"`
		Classes []string `json:"classes"`
	} `json:"data"`
}

type statusE2EResponse struct {
	Data struct {
		Status string `json:"status"`
	} `json:"data"`
}

func decodeE2E[T any](t *testing.T, body []byte) T {
	t.Helper()
	var out T
	require.NoError(t, json.Unmarshal(body, &out))
	return out
}

func eventTitles(listed schoolCalendarE2EResponse) []string {
	titles := make([]string, 0, len(listed.Data.Events))
	for _, event := range listed.Data.Events {
		titles = append(titles, event.Title)
	}
	return titles
}

// TestSchoolCalendarHTTPFlow drives the calendar of moto schule through its
// real router and data: a Lehrkraft plans, changes and deletes a Schultermin,
// answers an invitation of the OGS, reads and rotates her subscription feed.
func TestSchoolCalendarHTTPFlow(t *testing.T) {
	t.Parallel()
	db, module := setupCalendarModule(t)
	resource := calendarHTTP.NewResource(module.Calendar, nil, slog.Default())
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/calendar", resource.Router(rootAPI.TenantSessionChain))
	router.Mount("/school/calendar", resource.SchoolRouter(rootAPI.ProtectedSchoolRoutes))

	teacher, teacherAccount := testpkg.CreateTestCalendarStaff(t, db, "School", "CalendarFlow")
	testpkg.AssignLehrkraftSystemRole(t, db, teacherAccount.ID, testpkg.Tenant(t))
	testpkg.CreateTestClassTeacher(t, db, teacher.ID, "1a")
	claims := testutil.TenantUserTestClaims(int(teacherAccount.ID), testpkg.Tenant(t), permissions.CalendarSchool)
	claims.Scope = "school"
	token := testutil.MintTestJWT(t, claims)
	const days = "?from=2026-05-04&to=2026-05-05"

	appointment := map[string]any{
		"title": "Zoobesuch", "start_date": "2026-05-04", "end_date": "2026-05-04",
		"start_time": "09:00", "end_time": "12:00", "school_event_type": "ausflug", "parents": "none",
	}
	createRR := doJSON(t, router, http.MethodPost, "/school/calendar/appointments", token, appointment)
	require.Equal(t, http.StatusCreated, createRR.Code, createRR.Body.String())
	appointmentID := strconv.FormatInt(int64(decodeE2E[createAppointmentE2EResponse](t, createRR.Body.Bytes()).Data.Appointment.ID), 10)

	listRR := doJSON(t, router, http.MethodGet, "/school/calendar/my"+days, token, nil)
	require.Equal(t, http.StatusOK, listRR.Code, listRR.Body.String())
	listed := decodeE2E[schoolCalendarE2EResponse](t, listRR.Body.Bytes())
	assert.Equal(t, "2026-05-04", listed.Data.From)
	assert.Equal(t, "2026-05-05", listed.Data.To)
	assert.Equal(t, []string{"Zoobesuch"}, eventTitles(listed))
	assert.Equal(t, []string{"1a"}, listed.Data.Classes)

	// The change rests on the Schultermin as the calendar listed it.
	require.Len(t, listed.Data.Events, 1)
	require.NotEmpty(t, listed.Data.Events[0].Version)
	appointment["title"] = "Zoobesuch mit Picknick"
	appointment["expected_version"] = listed.Data.Events[0].Version
	updateRR := doJSON(t, router, http.MethodPut, "/school/calendar/appointments/"+appointmentID, token, appointment)
	require.Equal(t, http.StatusOK, updateRR.Code, updateRR.Body.String())
	appointment["title"] = "Zoobesuch ohne Picknick"
	staleRR := doJSON(t, router, http.MethodPut, "/school/calendar/appointments/"+appointmentID, token, appointment)
	require.Equal(t, http.StatusConflict, staleRR.Code, staleRR.Body.String())
	assert.Contains(t, staleRR.Body.String(), `"code":"general.changed_since_read"`)

	// The OGS invites the Lehrkraft; she answers in moto schule.
	_, organizerAccount := testpkg.CreateTestCalendarStaff(t, db, "School", "FlowOrganizer")
	manageToken := calendarToken(t, organizerAccount.ID, permissions.CalendarManage, permissions.CalendarOwn)
	inviteRR := doJSON(t, router, http.MethodPost, "/calendar/appointments", manageToken, map[string]any{
		"title": "Teamsitzung", "start_date": "2026-05-05", "end_date": "2026-05-05",
		"start_time": "14:00", "end_time": "15:00", "delivery_mode": "rsvp_required",
		"targets": []map[string]any{{"type": "staff", "id": teacher.ID}},
	})
	require.Equal(t, http.StatusCreated, inviteRR.Code, inviteRR.Body.String())
	invited := decodeE2E[createAppointmentE2EResponse](t, inviteRR.Body.Bytes())
	require.Len(t, invited.Data.Recipients, 1)
	respondPath := "/school/calendar/recipients/" + strconv.FormatInt(int64(invited.Data.Recipients[0].ID), 10) + "/response"
	respondRR := doJSON(t, router, http.MethodPost, respondPath, token, map[string]any{"status": "accepted"})
	require.Equal(t, http.StatusOK, respondRR.Code, respondRR.Body.String())
	assert.Equal(t, "accepted", decodeE2E[statusE2EResponse](t, respondRR.Body.Bytes()).Data.Status)

	listRR = doJSON(t, router, http.MethodGet, "/school/calendar/my"+days, token, nil)
	require.Equal(t, http.StatusOK, listRR.Code, listRR.Body.String())
	assert.ElementsMatch(t, []string{"Zoobesuch mit Picknick", "Teamsitzung"}, eventTitles(decodeE2E[schoolCalendarE2EResponse](t, listRR.Body.Bytes())))

	deleteRR := doJSON(t, router, http.MethodDelete, "/school/calendar/appointments/"+appointmentID, token, nil)
	require.Equal(t, http.StatusOK, deleteRR.Code, deleteRR.Body.String())
	assert.Equal(t, "deleted", decodeE2E[statusE2EResponse](t, deleteRR.Body.Bytes()).Data.Status)

	feedRR := doJSON(t, router, http.MethodGet, "/school/calendar/feed", token, nil)
	require.Equal(t, http.StatusOK, feedRR.Code, feedRR.Body.String())
	feed := decodeE2E[feedE2EResponse](t, feedRR.Body.Bytes())
	assert.Contains(t, feed.Data.WebcalURL, "webcal://")
	rotateRR := doJSON(t, router, http.MethodPost, "/school/calendar/feed/rotate", token, nil)
	require.Equal(t, http.StatusOK, rotateRR.Code, rotateRR.Body.String())
	rotated := decodeE2E[feedE2EResponse](t, rotateRR.Body.Bytes())
	assert.NotEmpty(t, rotated.Data.URL)
	assert.NotEqual(t, feed.Data.URL, rotated.Data.URL)
}

// TestSchoolParentConferenceHTTPFlow drives the Elternsprechtag of moto
// schule through its real router and data: offer, list, change and withdraw.
func TestSchoolParentConferenceHTTPFlow(t *testing.T) {
	t.Parallel()
	db, module := setupCalendarModule(t)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/school/calendar", calendarHTTP.NewResource(module.Calendar, nil, slog.Default()).SchoolRouter(rootAPI.ProtectedSchoolRoutes))
	teacher, account := testpkg.CreateTestStaffWithAccount(t, db, "Conference", "Flow")
	testpkg.AssignLehrkraftSystemRole(t, db, account.ID, testpkg.Tenant(t))
	testpkg.CreateTestClassTeacher(t, db, teacher.ID, "2b")
	claims := testutil.TenantUserTestClaims(int(account.ID), testpkg.Tenant(t), permissions.CalendarSchool)
	claims.Scope = "school"
	token := testutil.MintTestJWT(t, claims)
	const base = "/school/calendar/parent-conferences"

	conference := map[string]any{
		"school_class": "2b", "date": "2026-03-04", "start_time": "14:00", "end_time": "16:00", "slot_minutes": 15,
		"breaks": []map[string]any{{"start_time": "15:00", "end_time": "15:15"}},
	}
	createRR := doJSON(t, router, http.MethodPost, base, token, conference)
	require.Equal(t, http.StatusCreated, createRR.Code, createRR.Body.String())
	type conferenceWire struct {
		ID          string `json:"id"`
		SlotMinutes int    `json:"slot_minutes"`
		Slots       []any  `json:"slots"`
		Version     string `json:"version"`
	}
	created := decodeE2E[struct {
		Data conferenceWire `json:"data"`
	}](t, createRR.Body.Bytes())
	require.NotEmpty(t, created.Data.ID)
	assert.Len(t, created.Data.Slots, 7)

	listRR := doJSON(t, router, http.MethodGet, base, token, nil)
	require.Equal(t, http.StatusOK, listRR.Code, listRR.Body.String())
	listed := decodeE2E[struct {
		Data struct {
			Conferences []conferenceWire `json:"conferences"`
			Classes     []string         `json:"classes"`
		} `json:"data"`
	}](t, listRR.Body.Bytes())
	require.Len(t, listed.Data.Conferences, 1)
	assert.Equal(t, created.Data.ID, listed.Data.Conferences[0].ID)
	assert.Equal(t, []string{"2b"}, listed.Data.Classes)

	// The change rests on the day as listed (ADR 0311).
	conference["slot_minutes"] = 20
	conference["breaks"] = []any{}
	conference["expected_version"] = listed.Data.Conferences[0].Version
	updateRR := doJSON(t, router, http.MethodPut, base+"/"+created.Data.ID, token, conference)
	require.Equal(t, http.StatusOK, updateRR.Code, updateRR.Body.String())
	updated := decodeE2E[struct {
		Data conferenceWire `json:"data"`
	}](t, updateRR.Body.Bytes())
	assert.Equal(t, 20, updated.Data.SlotMinutes)
	assert.Len(t, updated.Data.Slots, 6)
	// The listed version is outdated now.
	conference["slot_minutes"] = 30
	staleRR := doJSON(t, router, http.MethodPut, base+"/"+created.Data.ID, token, conference)
	require.Equal(t, http.StatusConflict, staleRR.Code, staleRR.Body.String())
	assert.Contains(t, staleRR.Body.String(), `"code":"general.changed_since_read"`)

	deleteRR := doJSON(t, router, http.MethodDelete, base+"/"+created.Data.ID, token, nil)
	require.Equal(t, http.StatusOK, deleteRR.Code, deleteRR.Body.String())
	assert.Equal(t, "deleted", decodeE2E[statusE2EResponse](t, deleteRR.Body.Bytes()).Data.Status)
	listRR = doJSON(t, router, http.MethodGet, base, token, nil)
	require.Equal(t, http.StatusOK, listRR.Code, listRR.Body.String())
	assert.NotContains(t, listRR.Body.String(), `"id":"`+created.Data.ID+`"`)
}
