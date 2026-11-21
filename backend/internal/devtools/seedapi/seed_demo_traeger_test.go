package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/demoprofile"
)

// The visitor of an own Demo-Träger (ADR 0271) joins its Träger-Büro with
// every role of the office, under the caregiver's synthetic address, and the
// membership carries the visitor's name.
func TestVisitorJoinsTheTraegerBueroOfTheOwnTraeger(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	requests := map[string]seedTraegerRequest{}
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		raw, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		var body map[string]any
		if len(raw) > 0 {
			assert.NoError(t, json.Unmarshal(raw, &body))
		}
		mu.Lock()
		requests[r.Method+" "+r.URL.Path] = seedTraegerRequest{authorization: r.Header.Get("Authorization"), body: body}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/traeger/auth/login" {
			_, _ = w.Write([]byte(`{"status":"authenticated","access_token":"traeger-token","refresh_token":"traeger-refresh"}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"status":"success","data":{}}`))
	})
	defer srv.Close()

	visitor := DemoStaff[visitorStaffIndex]
	fixed := &FixedSeeder{
		visitor: visitorName{first: "Kim", last: "Test"},
		staffCredentials: []StaffCredentials{
			{AccountID: 41, Email: "anna@demo-abc.moto-ogs.de", Name: DemoStaff[0].FirstName + " " + DemoStaff[0].LastName},
			{AccountID: 42, Email: "julia@demo-abc.moto-ogs.de", Name: visitor.FirstName + " " + visitor.LastName},
		},
	}
	client := newTestClient(srv.URL, false)
	client.BindAuth(AuthRef{Kind: AuthBearer, Token: "tenant-token"})
	rt := &Runtime{
		Client: client, FixedSeeder: fixed,
		OperatorAuth: AuthRef{Kind: AuthBearer, Token: "operator-token"},
		Bootstrap:    &bootstrapSeedState{OrganizationID: 12, AdminEmail: "admin@example.test", AdminPassword: "Geheim1234%"},
	}

	step := seedVisitorTraegerBueroStep{seeder: &Seeder{options: SeedOptions{OwnTraeger: true}}}
	require.NoError(t, step.Run(context.Background(), rt))

	assign := requests["POST /operator/organizations/12/traeger-members"]
	assert.Equal(t, "Bearer operator-token", assign.authorization)
	assert.Equal(t, "julia@demo-abc.moto-ogs.de", assign.body["email"], "the synthetic address, never the visitor's own")
	assert.Len(t, assign.body["roles"], len(seedTraegerAdminRoles))
	name := requests["PUT /traeger/accounts/42/name"]
	assert.Equal(t, "Bearer traeger-token", name.authorization)
	assert.Equal(t, "Kim Test", name.body["name"])
	assert.Equal(t, "Bearer tenant-token", "Bearer "+client.auth.Token, "the step gives the tenant login back")
}

// Under the shared Demo-Träger, or without a visitor, no one joins the
// office: the step sends nothing.
func TestVisitorStaysOutOfASharedTraegerBuero(t *testing.T) {
	t.Parallel()

	srv := newSeedHTTPTestServer(func(_ seedHTTPResponseWriter, r *seedHTTPRequest) {
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
	})
	defer srv.Close()
	rt := &Runtime{
		Client:      newTestClient(srv.URL, false),
		FixedSeeder: &FixedSeeder{visitor: visitorName{first: "Kim", last: "Test"}},
		Bootstrap:   &bootstrapSeedState{OrganizationID: 12},
	}
	require.NoError(t, (seedVisitorTraegerBueroStep{seeder: &Seeder{}}).Run(context.Background(), rt))

	rt.FixedSeeder = &FixedSeeder{}
	require.NoError(t, (seedVisitorTraegerBueroStep{seeder: &Seeder{options: SeedOptions{OwnTraeger: true}}}).Run(context.Background(), rt))
	require.NoError(t, (seedDemoNeighbourSchoolsStep{seeder: &Seeder{}}).Run(context.Background(), rt))
}

// The Träger links no staff record that names the visitor's employment
// (ADR 0233 point 9): a record outlives the visit.
func TestTraegerStaffLinksLeaveTheVisitorOut(t *testing.T) {
	t.Parallel()

	const school, otherSchool, colleague, visitorStaff = 5, 6, 76, 77
	visitor := DemoStaff[visitorStaffIndex]
	rt := &Runtime{
		Bootstrap: &bootstrapSeedState{SchoolID: school},
		FixedSeeder: &FixedSeeder{
			visitor:  visitorName{first: "Kim", last: "Test"},
			staffIDs: map[string]int64{visitor.FirstName + " " + visitor.LastName: visitorStaff},
		},
	}
	suggestion := func(schoolID, staffID int64) seedTraegerStaffSuggestion {
		var s seedTraegerStaffSuggestion
		s.Members = append(s.Members, struct {
			SchoolID demoprofile.ID `json:"school_id"`
			StaffID  demoprofile.ID `json:"staff_id"`
		}{demoprofile.ID(schoolID), demoprofile.ID(staffID)})
		return s
	}
	kept := withoutVisitorStaff(rt, []seedTraegerStaffSuggestion{
		suggestion(school, colleague), suggestion(school, visitorStaff), suggestion(otherSchool, visitorStaff),
	})
	require.Len(t, kept, 2)
	assert.EqualValues(t, colleague, kept[0].Members[0].StaffID)
	assert.EqualValues(t, otherSchool, kept[1].Members[0].SchoolID, "the visitor's staff ID at another school is someone else")

	rt.FixedSeeder.visitor = visitorName{}
	assert.Len(t, withoutVisitorStaff(rt, []seedTraegerStaffSuggestion{suggestion(school, visitorStaff)}), 1, "a seed without a visitor keeps every proposal")
}

// A demo school's guest family has an address of the school's own, so no
// account joins the Träger of two visitors (ADR 0271); the local seed keeps
// the stable address.
func TestHolidayGuestFamilyAddressFollowsTheAccountScope(t *testing.T) {
	t.Parallel()

	assert.Equal(t, seedHolidayGuestFamilyEmail, seedHolidayGuestEmail(&Runtime{FixedSeeder: &FixedSeeder{}}))
	assert.Equal(t, seedHolidayGuestFamilyEmail, seedHolidayGuestEmail(&Runtime{}))
	assert.Equal(t, "ferien.gastfamilie@demo-abc123.moto-ogs.de", seedHolidayGuestEmail(&Runtime{FixedSeeder: &FixedSeeder{accountScope: "abc123"}}))
}
