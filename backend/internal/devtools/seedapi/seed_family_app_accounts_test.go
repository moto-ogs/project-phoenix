package api

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func demoGuardianIDs() map[string]int64 {
	ids := make(map[string]int64, len(DemoGuardians))
	for index, guardian := range DemoGuardians {
		ids[guardian.FirstName+" "+guardian.LastName] = int64(1000 + index)
	}
	return ids
}

// Every demo child gets a parent in the app (#3894), except the families the
// demo keeps without one on purpose and the ones that already have an account.
func TestFamilyAppGuardiansCoverEveryOtherChildOnce(t *testing.T) {
	t.Parallel()

	ids := demoGuardianIDs()
	// Sabine Schneider (child 0) already has an account; Klaus Schneider is the
	// other parent of the same child.
	parents := []ParentCredentials{{GuardianID: ids["Sabine Schneider"]}}

	indexes, err := familyAppGuardianIndexes(ids, parents)
	require.NoError(t, err)

	// A guardian of siblings has one entry per child and one account for all.
	entriesByID := make(map[int64][]DemoGuardian, len(DemoGuardians))
	for _, guardian := range DemoGuardians {
		id := ids[guardian.FirstName+" "+guardian.LastName]
		entriesByID[id] = append(entriesByID[id], guardian)
	}
	children := map[int]bool{}
	listed := map[int64]bool{}
	for _, index := range indexes {
		require.Less(t, index, len(DemoGuardians), "index %d is a demo guardian", index)
		id := ids[demoGuardianKey(DemoGuardians[index])]
		assert.False(t, listed[id], "guardian %d is listed once", id)
		listed[id] = true
		for _, guardian := range entriesByID[id] {
			assert.True(t, guardian.IsPrimary, "%s %s", guardian.FirstName, guardian.LastName)
			assert.False(t, children[guardian.StudentIndex], "child %d gets one account", guardian.StudentIndex)
			children[guardian.StudentIndex] = true
		}
	}
	assert.False(t, children[0], "child 0 already has a parent in the app")
	for index := range familiesWithoutApp {
		assert.False(t, children[index], "child %d stays without app", index)
	}
	assert.Len(t, children, len(DemoStudents)-1-len(familiesWithoutApp))
}

func TestFamilyAppGuardiansReportAMissingGuardian(t *testing.T) {
	t.Parallel()

	_, err := familyAppGuardianIndexes(map[string]int64{}, nil)
	require.Error(t, err)
}

// The families without app must be children the re-enrollment overview lists:
// not the top grade, which leaves the school.
func TestFamiliesWithoutAppAreReEnrolled(t *testing.T) {
	t.Parallel()

	for index := range familiesWithoutApp {
		require.Less(t, index, len(DemoStudents))
		grade, err := demoClassGrade(DemoStudents[index].Class)
		require.NoError(t, err)
		assert.Less(t, grade, 4, "child %d", index)
	}
}

// The parents of approved online enrollments get an account, except two the
// school still sees waiting. The guardian list of each child marks an open
// invitation as pending; the listing carries no token (#4902). A child whose
// care starts later must also get an account, even on a later student page.
func TestEnrollmentInvitationsKeepTwoOpen(t *testing.T) {
	t.Parallel()

	guardians := map[string]string{
		"/api/guardians/students/11/guardians": `[{"guardian":{"id":"704"},"account_status":"pending"},{"guardian":{"id":"801"},"account_status":"active"}]`,
		"/api/guardians/students/12/guardians": `[{"guardian":{"id":"701"},"account_status":"pending"},{"guardian":{"id":"703"},"account_status":"pending"}]`,
		"/api/guardians/students/13/guardians": `[{"guardian":{"id":"702"},"account_status":"pending"},{"guardian":{"id":"704"},"account_status":"pending"},{"guardian":{"id":"802"},"account_status":"none"}]`,
		"/api/guardians/students/14/guardians": `[{"guardian":{"id":"705"},"account_status":"pending"}]`,
	}
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		if r.URL.Path == "/api/students" {
			if r.URL.Query().Get("page") == "2" {
				// Like the administrative list, include the child awaiting care
				// start only when the caller asks for pending children too.
				students := `[]`
				if r.URL.Query().Get("include_pending_withdrawals") == "true" {
					students = `[{"id":"14"}]`
				}
				_, _ = fmt.Fprint(w, `{"status":"success","data":`+students+`,"pagination":{"total_pages":2}}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"status":"success","data":[{"id":"11"},{"id":"12"},{"id":"13"}],"pagination":{"total_pages":2}}`)
			return
		}
		body, ok := guardians[r.URL.Path]
		require.True(t, ok, "unexpected path %s", r.URL.Path)
		_, _ = fmt.Fprint(w, `{"status":"success","data":`+body+`}`)
	})
	defer srv.Close()

	rt := &Runtime{Client: newTestClient(srv.URL, false)}
	invitations, err := enrollmentInvitationsToAccept(rt, AuthRef{Token: "admin"})
	require.NoError(t, err)
	assert.Equal(t, []int64{703, 704, 705}, invitations)
}
