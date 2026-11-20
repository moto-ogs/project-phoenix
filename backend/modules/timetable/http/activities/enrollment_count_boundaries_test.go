package httpadapter_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	rootAPI "github.com/moto-ogs/project-phoenix/api"
	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	activitiesAPI "github.com/moto-ogs/project-phoenix/modules/timetable/http/activities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

type countGroupOrderService struct {
	activityContract.ActivityService
	groups []*activityContract.Group
}

func (s countGroupOrderService) GetStudentEnrollments(context.Context, int64) ([]*activityContract.Group, error) {
	return s.groups, nil
}

func (s countGroupOrderService) GetAvailableGroups(context.Context, int64) ([]*activityContract.Group, error) {
	return s.groups, nil
}

func TestStudentActivityCountsKeepNilSkippingAndGroupOrder(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	_, service, _, caller, err := rootAPI.NewActivitiesTestModule(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	one := testpkg.CreateTestActivityGroup(t, db, "First ordered")
	two := testpkg.CreateTestActivityGroup(t, db, "Second ordered")
	first, err := service.GetGroup(testpkg.Ctx(t), one.ID)
	require.NoError(t, err)
	second, err := service.GetGroup(testpkg.Ctx(t), two.ID)
	require.NoError(t, err)
	for _, groups := range [][]*activityContract.Group{nil, {nil, nil}, {nil, second, first, nil, second}} {
		ordered := countGroupOrderService{ActivityService: service, groups: groups}
		resource := activitiesAPI.NewResource(ordered, nil, nil, caller, rootAPI.TimetableHTTPTransactions)
		candidate := chi.NewRouter()
		candidate.Mount("/api/activities", resource.Router(rootAPI.ProtectedTenantRoutes))
		scalar := *resource
		scalar.ActivityService = scalarEnrollmentCountService{ordered}
		original := chi.NewRouter()
		original.Mount("/api/activities", scalar.Router(rootAPI.ProtectedTenantRoutes))
		for _, suffix := range []string{""} {
			path := fmt.Sprintf("/api/activities/students/%d%s", one.ID, suffix)
			want, got := enrollmentCountRequest(t, original, path), enrollmentCountRequest(t, candidate, path)
			require.Equal(t, http.StatusOK, got.Code, got.Body.String())
			require.Equal(t, want.Header(), got.Header())
			require.Equal(t, want.Body.String(), got.Body.String())
		}
	}
}

func TestStudentActivityCountsKeepTargetLifecycleResponses(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	original, candidate, _, _ := countComparisonRouters(t, db)
	student := testpkg.CreateTestStudent(t, db, "Lifecycle", "Target", "1a")
	for _, graduated := range []bool{false, true} {
		status := "active"
		if graduated {
			status = testpkg.StudentStatusAlumnus
		}
		ended := calendar.NewDate(2025, 1, 1)
		testpkg.SetStudentLifecycle(t, db, student.ID, status, nil, &ended)
		for _, suffix := range []string{""} {
			path := fmt.Sprintf("/api/activities/students/%d%s", student.ID, suffix)
			want, got := enrollmentCountRequest(t, original, path), enrollmentCountRequest(t, candidate, path)
			require.Equal(t, want.Code, got.Code)
			require.Equal(t, want.Header(), got.Header())
			require.Equal(t, want.Body.String(), got.Body.String())
		}
	}
}
