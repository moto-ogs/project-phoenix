package api

import (
	"fmt"
	"testing"

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
