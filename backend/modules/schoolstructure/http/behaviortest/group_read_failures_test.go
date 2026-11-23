package schoolstructurehttp_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	schoolHTTP "github.com/moto-ogs/project-phoenix/modules/schoolstructure/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// failingGroupChildren fails the read of a group's children.
type failingGroupChildren struct {
	schoolHTTP.GroupPeople
}

func (failingGroupChildren) GroupStudents(context.Context, int64) ([]peopledirectory.StudentRecord, error) {
	return nil, errors.New("children unavailable")
}

// A failed children read is no empty group: the group answers 500 instead of
// a student count of 0 (#6849).
func TestGetGroup_ChildrenReadFailureIsAnError(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)
	group := testpkg.CreateTestEducationGroup(t, tc.db, "CountFailure")
	tc.resource.People = failingGroupChildren{GroupPeople: tc.resource.People}

	rr := testutil.ExecuteRequest(router, newReq(t, http.MethodGet,
		fmt.Sprintf("/groups/%d", group.ID), nil, testutil.DefaultTestClaims(), "groups:read"))
	testutil.AssertErrorResponse(t, rr, http.StatusInternalServerError)
}

// A failed read-back after an update answers 500 and rolls the update back,
// instead of confirming it with a student count of 0 (#6849).
func TestUpdateGroup_ReadBackFailureRollsBack(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)
	group := testpkg.CreateTestEducationGroup(t, tc.db, "ReadBackFailure")
	version := groupVersion(t, router, group.ID, testutil.DefaultTestClaims())
	tc.resource.People = failingGroupChildren{GroupPeople: tc.resource.People}

	rr := testutil.ExecuteRequest(router, newReq(t, http.MethodPut,
		fmt.Sprintf("/groups/%d", group.ID), map[string]any{"name": fmt.Sprintf("Renamed-%d", group.ID), "expected_version": version},
		testutil.DefaultTestClaims(), "groups:update"))
	testutil.AssertErrorResponse(t, rr, http.StatusInternalServerError)

	stored, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), tc.db, tc.resource.EducationService.GetGroup, group.ID)
	require.NoError(t, err)
	require.Equal(t, group.Name, stored.Name)
}

// failingGroupCounts fails the batched child count of the group list.
type failingGroupCounts struct {
	schoolHTTP.GroupPeople
}

func (failingGroupCounts) CountByGroupIDs(context.Context, []int64) (map[int64]int, error) {
	return nil, errors.New("counts unavailable")
}

// A failed count read is no list of empty groups (#6849).
func TestListGroups_CountReadFailureIsAnError(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)
	testpkg.CreateTestEducationGroup(t, tc.db, "ListCountFailure")
	tc.resource.People = failingGroupCounts{GroupPeople: tc.resource.People}

	rr := testutil.ExecuteRequest(router, newReq(t, http.MethodGet, "/groups/", nil, testutil.DefaultTestClaims(), "groups:read"))
	testutil.AssertErrorResponse(t, rr, http.StatusInternalServerError)
}
