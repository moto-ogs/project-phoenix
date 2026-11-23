package careplanhttp_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// absenceKeys are the body keys of a pure absence report, which reads no
// form and so carries no version (ADR 0311).
var absenceKeys = map[string]bool{"sick": true, "excused": true, "sick_reason": true}

// studentRecordVersion is the version the child detail read hands the edit
// form: the master data as stored now.
func studentRecordVersion(t *testing.T, tc *testContext, studentID int64) string {
	t.Helper()
	ctx := testpkg.Ctx(t)
	record, err := tc.resource.PeopleDirectory.FindStudentRecord(ctx, studentID)
	require.NoError(t, err)
	student := peopleModule.StudentStateFromRecord(record)
	person, err := tc.resource.PeopleDirectory.FindPerson(ctx, student.PersonID)
	require.NoError(t, err)
	return peopleModule.StudentRecordVersion(*student, person)
}

// studentUpdateRequest is the PUT /{id} a form sends after reading the child:
// a body with master data carries the version of the stored state unless the
// case sets its own.
func studentUpdateRequest(t *testing.T, tc *testContext, studentID int64, body map[string]any) *http.Request {
	t.Helper()
	if _, own := body["expected_version"]; !own {
		for key := range body {
			if !absenceKeys[key] {
				body["expected_version"] = studentRecordVersion(t, tc, studentID)
				break
			}
		}
	}
	return testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/%d", studentID), body)
}

// TestUpdateStudentRefusesMasterDataChangedSinceRead pins ADR 0311 for the
// child's edit form: it sends every field back, so a save made against an
// older read would put back what a colleague changed since.
func TestUpdateStudentRefusesMasterDataChangedSinceRead(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t)
	student := testpkg.CreateTestStudent(t, tc.db, "Stale", "Form", "SF1")
	opened := studentRecordVersion(t, tc, student.ID)

	// A colleague renames the child after the form opened.
	rr := authExec(t, tc, studentUpdateRequest(t, tc, student.ID, map[string]any{"last_name": "Kollegin"}), testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	for name, version := range map[string]string{"older read": opened, "no read": ""} {
		body := map[string]any{"last_name": "Form", "school_class": "SF2", "expected_version": version}
		rr = authExec(t, tc, studentUpdateRequest(t, tc, student.ID, body), testutil.AdminTestClaims(1), []string{"admin:*"})
		require.Equal(t, http.StatusConflict, rr.Code, "%s: %s", name, rr.Body.String())
		require.Contains(t, rr.Body.String(), `"code":"general.changed_since_read"`, name)
		record, err := tc.resource.PeopleDirectory.FindStudentRecord(testpkg.Ctx(t), student.ID)
		require.NoError(t, err)
		stored := peopleModule.StudentStateFromRecord(record)
		person, err := tc.resource.PeopleDirectory.FindPerson(testpkg.Ctx(t), stored.PersonID)
		require.NoError(t, err)
		require.Equal(t, "Kollegin", person.LastName, name)
		require.Equal(t, "SF1", stored.SchoolClass, name)
	}

	// A pure absence report reads no form and needs no version.
	beforeExcuse := studentRecordVersion(t, tc, student.ID)
	rr = authExec(t, tc, studentUpdateRequest(t, tc, student.ID, map[string]any{"excused": true}), testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	// The excuse changed no master data: a form read before it still saves.
	rr = authExec(t, tc, studentUpdateRequest(t, tc, student.ID, map[string]any{"school_class": "SF2", "expected_version": beforeExcuse}), testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
}
