package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The child that changes its school is the last active contract of the
// school that holds on the first of the month, names a student record, a
// family and a date of birth, and is no other example's child (#7874).
func TestSeedSchoolChangeContractPicksTheLastFittingChild(t *testing.T) {
	t.Parallel()
	var details []string
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/traeger/contracts/":
			assert.Equal(t, "aktiv", r.URL.Query().Get("status"))
			_, _ = fmt.Fprint(w, `{"data":{"contracts":[
				{"id":1,"school_id":5,"student_id":11,"child_first_name":"Mila","child_last_name":"Ernst","party_email":"ernst@example.test","effective_from":"2026-08-01"},
				{"id":2,"school_id":5,"student_id":12,"child_first_name":"Ben","child_last_name":"Kraus","party_email":"kraus@example.test","effective_from":"2026-08-01"},
				{"id":3,"school_id":5,"student_id":13,"child_first_name":"Juna","child_last_name":"Lenz","party_email":"lenz@example.test","effective_from":"2026-11-05"},
				{"id":4,"school_id":5,"student_id":null,"child_first_name":"Ole","child_last_name":"Fink","party_email":"fink@example.test","effective_from":"2026-08-01"},
				{"id":5,"school_id":5,"student_id":14,"child_first_name":"Tilda","child_last_name":"Berger","party_email":"berger@example.test","effective_from":"2026-08-01"},
				{"id":6,"school_id":6,"student_id":15,"child_first_name":"Ida","child_last_name":"Roth","party_email":"roth@example.test","effective_from":"2026-08-01"}
			]}}`)
		case "/traeger/contracts/2":
			details = append(details, r.URL.Path)
			_, _ = fmt.Fprint(w, `{"data":{"version":{"child_first_name":"Ben","child_last_name":"Kraus","child_birth_date":null},"parties":[{"email":"kraus@example.test"}]}}`)
		case "/traeger/contracts/1":
			details = append(details, r.URL.Path)
			_, _ = fmt.Fprint(w, `{"data":{"version":{"child_first_name":"Mila","child_last_name":"Ernst","child_birth_date":"2018-04-09"},
				"parties":[{"first_name":"Lea","last_name":"Ernst","email":"ernst@example.test"}]}}`)
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
		}
	})
	defer srv.Close()

	child, ok, err := seedSchoolChangeContract(newTestClient(srv.URL, false), AuthRef{}, 5, calendar.NewDate(2026, 11, 1))
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, []string{"/traeger/contracts/2", "/traeger/contracts/1"}, details, "Ben has no date of birth")
	assert.Equal(t, seedSchoolChangeChild{id: 1, firstName: "Mila", lastName: "Ernst", birthDate: calendar.NewDate(2018, 4, 9),
		party: seedSchoolChangeParty{FirstName: "Lea", LastName: "Ernst", Email: "ernst@example.test"}}, child)
}

// A repeated seed finds the phase of the change at the Demo-Schule Manuell
// and moves no second child (#7874).
func TestSeedSchoolChangeRunsOnce(t *testing.T) {
	t.Parallel()
	for name, body := range map[string]string{
		"first seed":    `{"data":[{"name":"Schuljahr 2026/27"}]}`,
		"repeated seed": `{"data":[{"name":"Schuljahr 2026/27"},{"name":"Aufnahme im laufenden Schuljahr"}]}`,
	} {
		srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
			assert.Equal(t, "/api/enrollment/phases", r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, body)
		})
		done, err := seedSchoolChangeDone(newTestClient(srv.URL, false), AuthRef{})
		srv.Close()
		require.NoError(t, err, name)
		assert.Equal(t, name == "repeated seed", done, name)
	}
}

// The run of the month after the change stays open at the new school: the
// Jahresbescheid of the old school assesses that month, so the run holds the
// child back (#7892). In December no notice assesses a next month.
func TestSeedSchoolChangeLeavesTheNextMonthOpen(t *testing.T) {
	t.Parallel()
	var started []string
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		require.Equal(t, "/traeger/care-billing-runs/", r.URL.Path)
		if r.Method == http.MethodGet {
			_, _ = fmt.Fprint(w, `{"data":{"runs":[{"id":3,"billing_month":"2026-11-01","status":"calculated","school_ids":[6]}]}}`)
			return
		}
		started = append(started, r.Method)
		_, _ = fmt.Fprint(w, `{"data":{"id":4}}`)
	})
	defer srv.Close()
	client := newTestClient(srv.URL, false)

	require.NoError(t, seedSchoolChangeHeldRun(client, AuthRef{}, 6, calendar.NewDate(2026, 12, 1)))
	assert.Empty(t, started, "a change in December starts no run of January")
	require.NoError(t, seedSchoolChangeHeldRun(client, AuthRef{}, 6, calendar.NewDate(2026, 11, 1)))
	assert.Equal(t, []string{http.MethodPost}, started, "the run of December is started for the school")
}

// A seed that crosses midnight before the school change concluded the old
// contract on the new day, on the server's clock. The step dates the change,
// the receipt and the end of the termination from its own clock, not from
// the frozen seed day, so the receipt never lies before the conclusion; it
// failed with care_contract.field_invalid before.
func TestSeedSchoolChangeDatesFromTheClockPastMidnight(t *testing.T) {
	t.Parallel()
	berlin := seedBerlinLocation()
	rt := &Runtime{
		Bootstrap:          &bootstrapSeedState{OrganizationID: 7},
		FixedSeeder:        &FixedSeeder{seedDay: seedDateAt(time.Date(2026, 11, 24, 23, 50, 0, 0, berlin))},
		AdditionalProfiles: map[string]*SeedProfile{ManualProfileKey: {Organization: SeedOrganizationRef{ID: 7}}},
	}
	step := seedTraegerSchoolChangeStep{now: func() time.Time { return time.Date(2026, 11, 25, 0, 1, 0, 0, berlin) }}

	manual, today, ok := seedSchoolChangeDay(rt, step.today())
	require.True(t, ok)
	assert.Same(t, rt.AdditionalProfiles[ManualProfileKey], manual)
	assert.Equal(t, calendar.NewDate(2026, 11, 25), today, "the day the server concluded the old contract on")

	var bodies []map[string]any
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":{}}`)
	})
	defer srv.Close()
	require.NoError(t, seedSchoolChangeEnd(newTestClient(srv.URL, false), AuthRef{}, 9, today))
	require.Len(t, bodies, 2)
	assert.Equal(t, "2026-11-25", bodies[0]["received_on"])
	assert.Equal(t, "2026-11-25", bodies[1]["ends_on"])

	// Past midnight into a new month the step changes within that month;
	// on the last day of a month it moves no child.
	rt.FixedSeeder.seedDay = seedDateAt(time.Date(2026, 11, 30, 23, 50, 0, 0, berlin))
	_, today, ok = seedSchoolChangeDay(rt, calendar.NewDate(2026, 12, 1))
	require.True(t, ok)
	assert.Equal(t, calendar.NewDate(2026, 12, 1), today)
	_, _, ok = seedSchoolChangeDay(rt, calendar.NewDate(2026, 11, 30))
	assert.False(t, ok)
}
