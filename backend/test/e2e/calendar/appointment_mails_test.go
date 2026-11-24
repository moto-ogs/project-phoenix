package calendar_e2e_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

type appointmentMailsResponse struct {
	Data struct {
		Kinds      map[string]map[string]int `json:"kinds"`
		NotArrived map[string][]string       `json:"not_arrived"`
	} `json:"data"`
}

func createMailedAppointment(t *testing.T, router http.Handler, token string, guardianProfileIDs ...int64) string {
	t.Helper()
	targets := make([]map[string]any, 0, len(guardianProfileIDs))
	for _, id := range guardianProfileIDs {
		targets = append(targets, map[string]any{"type": "guardian_profile", "id": id})
	}
	rec := doJSON(t, router, http.MethodPost, "/calendar/appointments", token, map[string]any{
		"title": "Elternabend", "start_date": "2026-05-04", "end_date": "2026-05-04", "start_time": "18:00", "end_time": "19:00",
		"delivery_mode": "informational", "send_email": true, "targets": targets,
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var created createAppointmentE2EResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	return strconv.FormatInt(int64(created.Data.Appointment.ID), 10)
}

func readAppointmentMails(t *testing.T, router http.Handler, token, appointmentID string) appointmentMailsResponse {
	t.Helper()
	rec := doJSON(t, router, http.MethodGet, "/calendar/appointments/"+appointmentID+"/mails", token, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out appointmentMailsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

// The organizer of an appointment sees what became of its e-mails to the
// guardians (#7058): counted by kind and outcome, each guardian once per kind
// with the newest mail, and by name the guardians whose mail did not arrive.
// Real outbox, real outcome read; nobody else reads it.
func TestOrganizerSeesWhatBecameOfTheAppointmentMails(t *testing.T) {
	t.Parallel()
	db, router := setupParentCalendarRoute(t)
	_, organizer := testpkg.CreateTestCalendarStaff(t, db, "Mail", "Organizer")
	token := calendarToken(t, organizer.ID, permissions.CalendarOwn, permissions.CalendarManage)
	reached := testpkg.CreateTestParentGuardianChain(t, db)
	bounced := testpkg.CreateTestParentGuardianChain(t, db)
	_, err := db.NewRaw(`UPDATE users.guardian_profiles SET first_name = 'Bernd', last_name = 'Beispiel' WHERE id = ?`, bounced.GuardianProfileID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)

	appointmentID := createMailedAppointment(t, router, token, reached.GuardianProfileID, bounced.GuardianProfileID)
	mails := readAppointmentMails(t, router, token, appointmentID)
	require.Equal(t, map[string]map[string]int{"appointment_published": {"queued": 2}}, mails.Data.Kinds, "one mail per guardian")
	require.Empty(t, mails.Data.NotArrived)

	_, err = db.NewRaw(`UPDATE platform.email_outbox SET status = 'sent', sent_at = now(), delivery_state = 'failed', delivery_state_at = now()
		WHERE related_entity_type = 'calendar_appointment' AND related_entity_id = ? AND LOWER(recipient->>'address') = LOWER(?)`,
		appointmentID, bounced.Email).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	mails = readAppointmentMails(t, router, token, appointmentID)
	require.Equal(t, map[string]int{"queued": 1, "undeliverable": 1}, mails.Data.Kinds["appointment_published"])
	require.Equal(t, map[string][]string{"appointment_published": {"Bernd Beispiel"}}, mails.Data.NotArrived, "named, never an address")

	// Two changes mail each guardian twice; the newest mail counts.
	for _, title := range []string{"Elternabend neu", "Elternabend später"} {
		rec := doJSON(t, router, http.MethodPut, "/calendar/appointments/"+appointmentID, token, map[string]any{
			"title": title, "start_date": "2026-05-04", "end_date": "2026-05-04", "start_time": "18:30", "end_time": "19:30", "send_email": true,
			"expected_version": appointmentVersionE2E(t, router, "/calendar/appointments/"+appointmentID, token),
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	mails = readAppointmentMails(t, router, token, appointmentID)
	require.Equal(t, map[string]int{"queued": 2}, mails.Data.Kinds["appointment_updated"])
	require.Equal(t, map[string]int{"cancelled": 1, "undeliverable": 1}, mails.Data.Kinds["appointment_published"], "the change replaced the unsent mail")

	// Another staff member of the school may not read it, nor may another school.
	_, colleague := testpkg.CreateTestCalendarStaff(t, db, "Mail", "Colleague")
	rec := doJSON(t, router, http.MethodGet, "/calendar/appointments/"+appointmentID+"/mails", calendarToken(t, colleague.ID, permissions.CalendarOwn, permissions.CalendarManage), nil)
	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	foreignTenant, _ := testpkg.CreateTestTenant(t, db)
	_, foreign := testpkg.CreateTestStaffWithAccountForTenant(t, db, foreignTenant, "Foreign", "Mail")
	testpkg.EnsureAccountTenant(t, db, foreign.ID, foreignTenant)
	foreignToken := testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(foreign.ID), foreignTenant, permissions.CalendarOwn, permissions.CalendarManage))
	rec = doJSON(t, router, http.MethodGet, "/calendar/appointments/"+appointmentID+"/mails", foreignToken, nil)
	require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
}

// The mail status reads the same number of statements for three or eight
// mailed guardians (#7058).
func TestAppointmentMailsPositiveGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	for _, n := range []int{3, 8} {
		t.Run(fmt.Sprintf("N%d", n), func(t *testing.T) {
			testpkg.OwnTenant(t)
			testpkg.SetupIsolatedTestDB(t)
			db, router := setupParentCalendarRoute(t)
			_, organizer := testpkg.CreateTestCalendarStaff(t, db, "Mail", "Budget")
			token := calendarToken(t, organizer.ID, permissions.CalendarOwn, permissions.CalendarManage)
			guardians := make([]int64, 0, n)
			for range n {
				guardians = append(guardians, testpkg.CreateTestParentGuardianChain(t, db).GuardianProfileID)
			}
			appointmentID := createMailedAppointment(t, router, token, guardians...)
			// A refused mail makes the read name its guardian too.
			_, err := db.NewRaw(`UPDATE platform.email_outbox SET status = 'sent', sent_at = now(), delivery_state = 'failed', delivery_state_at = now()
				WHERE related_entity_type = 'calendar_appointment' AND related_entity_id = ?`, appointmentID).Exec(testpkg.Ctx(t))
			require.NoError(t, err)
			counter := testpkg.CaptureQueries(t, db)
			counter.Reset()
			rec := doJSON(t, testpkg.MountedQueryBudgetRouter("/api", router), http.MethodGet, "/calendar/appointments/"+appointmentID+"/mails", token, nil)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			var out appointmentMailsResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
			require.Equal(t, map[string]int{"undeliverable": n}, out.Data.Kinds["appointment_published"])
			require.Len(t, out.Data.NotArrived["appointment_published"], 1, "every guardian of the fixture is called Sabine Schneider")
			measurement := counter.Measurement(counter.Queries())
			t.Logf("calendar appointment_mails N%d statements=%d", n, len(measurement.Statements))
			querybudgets.AssertQueryBudget(t, "api.calendar.appointment_mails.positive_growth", measurement)
		})
	}
}
