package schoolstructurehttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	rootAPI "github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	schoolHTTP "github.com/moto-ogs/project-phoenix/modules/schoolstructure/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

func TestPresenceGroups20SchoolQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tc := setupGroupsRoute(t)
	require.Same(t, db, tc.db)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/api/groups", tc.resource.Router(rootAPI.ProtectedTenantRoutes))
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Groups20", "Reader")
	claims := testutil.AdminTestClaimsForTenant(int(account.ID), testpkg.Tenant(t))
	foreign := testpkg.NewTenantScope(t, db)
	hidden := testpkg.CreateTestEducationGroupForTenant(t, db, foreign.TenantID, "ForeignGroups20")
	group := testpkg.CreateTestEducationGroup(t, db, "Groups20Target")
	students := 0
	var teachers []schoolHTTP.TeacherResponse
	var groups []int64
	expectedGroups := map[int64]schoolHTTP.GroupResponse{group.ID: {ID: ident.ID(group.ID), Name: group.Name, CreatedAt: group.CreatedAt.UTC(), UpdatedAt: group.UpdatedAt.UTC()}}
	groups = append(groups, group.ID)
	counter := testpkg.CaptureQueries(t, db)
	counter.Stop()
	type sample struct {
		scenario string
		n        int
		queries  testpkg.QueryMeasurement
	}
	var samples []sample
	for _, n := range []int{3, 8} {
		for students < n {
			i := students
			child := testpkg.CreateTestStudent(t, db, "Groups20", fmt.Sprintf("Child%02d", i), "G20")
			testpkg.AssignStudentToGroup(t, db, child.ID, group.ID)
			students++
			teacher := testpkg.CreateTestTeacher(t, db, "Groups20", fmt.Sprintf("Teacher%02d", i))
			testpkg.CreateTestGroupTeacher(t, db, group.ID, teacher.ID)
			teachers = append(teachers, schoolHTTP.TeacherResponse{ID: ident.ID(teacher.ID), StaffID: ident.ID(teacher.StaffID), FirstName: "Groups20", LastName: fmt.Sprintf("Teacher%02d", i), FullName: fmt.Sprintf("Groups20 Teacher%02d", i)})
		}
		for len(groups) < n {
			g := testpkg.CreateTestEducationGroup(t, db, fmt.Sprintf("Groups20List%02d", len(groups)))
			groups = append(groups, g.ID)
			expectedGroups[g.ID] = schoolHTTP.GroupResponse{ID: ident.ID(g.ID), Name: g.Name, CreatedAt: g.CreatedAt.UTC(), UpdatedAt: g.UpdatedAt.UTC()}
		}
		target := expectedGroups[group.ID]
		target.StudentCount = n
		target.Teachers = teachers
		target.Representative = &teachers[0]
		target.RepresentativeID = &teachers[0].ID
		expectedGroups[group.ID] = target
		for _, suffix := range []string{"/", fmt.Sprintf("/%d", group.ID)} {
			counter.Reset()
			counter.Start()
			rr := testutil.ExecuteRequest(router, newReq(t, http.MethodGet, "/api/groups"+suffix, nil, claims, "admin:*"))
			counter.Stop()
			require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
			require.Zero(t, counter.WriteRows())
			for _, op := range []string{"INSERT", "UPDATE", "DELETE", "MERGE"} {
				require.Empty(t, counter.Operation(op))
			}
			var envelope struct {
				Data json.RawMessage `json:"data"`
			}
			require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
			scenario := ""
			switch suffix {
			case "/":
				var rows []schoolHTTP.GroupResponse
				require.NoError(t, json.Unmarshal(envelope.Data, &rows))
				require.Len(t, rows, n)
				var ids []int64
				for _, row := range rows {
					ids = append(ids, row.ID.Int64())
					row.CreatedAt = row.CreatedAt.UTC()
					row.UpdatedAt = row.UpdatedAt.UTC()
					require.Equal(t, expectedGroups[row.ID.Int64()], row)
					require.NotEqual(t, hidden.ID, row.ID)
					if row.ID == ident.ID(group.ID) {
						require.Equal(t, n, row.StudentCount)
						require.Equal(t, teachers, row.Teachers)
					}
				}
				require.ElementsMatch(t, groups, ids)
				scenario = "api.groups.presence20.list"
			default:
				var row schoolHTTP.GroupResponse
				require.NoError(t, json.Unmarshal(envelope.Data, &row))
				row.CreatedAt = row.CreatedAt.UTC()
				row.UpdatedAt = row.UpdatedAt.UTC()
				require.Equal(t, expectedGroups[group.ID], row)
				require.Equal(t, group.Name, row.Name)
				require.Equal(t, n, row.StudentCount)
				require.Equal(t, teachers, row.Teachers)
				scenario = "api.groups.presence20.detail"
			}
			t.Logf("PRESENCE20 scenario=%s n=%d statements=%d sql=%q body=%s", scenario, n, counter.Total(), counter.Queries(), rr.Body.String())
			samples = append(samples, sample{scenario, n, counter.Measurement(counter.Queries())})
		}
	}
	for _, suffix := range []string{"/", fmt.Sprintf("/%d", group.ID)} {
		rr := testutil.ExecuteRequest(router, testutil.NewRequest("GET", "/api/groups"+suffix, nil))
		require.Equal(t, 401, rr.Code)
		denied := testutil.TeacherTestClaims(int(account.ID))
		denied.IsAdmin = false
		rr = testutil.ExecuteRequest(router, newReq(t, "GET", "/api/groups"+suffix, nil, denied))
		require.Equal(t, 403, rr.Code)
	}
	for _, s := range samples {
		t.Run(fmt.Sprintf("%s.n%d", s.scenario, s.n), func(t *testing.T) { assertPresence20SchoolBudget(t, s.scenario, s.n, s.queries) })
	}
	for _, suffix := range []string{""} {
		rr := testutil.ExecuteRequest(router, newReq(t, "GET", fmt.Sprintf("/api/groups/%d%s", hidden.ID, suffix), nil, claims, "admin:*"))
		require.Equal(t, 404, rr.Code)
	}
}

func assertPresence20SchoolBudget(t *testing.T, scenario string, n int, queries querybudgets.Measurement) {
	t.Helper()
	// Literal references keep the budget completeness gate authoritative.
	switch fmt.Sprintf("%s.n%d", scenario, n) {
	case "api.groups.presence20.list.n3":
		querybudgets.AssertQueryBudget(t, "api.groups.presence20.list.n3", queries)
	case "api.groups.presence20.list.n8":
		querybudgets.AssertQueryBudget(t, "api.groups.presence20.list.n8", queries)
	case "api.groups.presence20.detail.n3":
		querybudgets.AssertQueryBudget(t, "api.groups.presence20.detail.n3", queries)
	case "api.groups.presence20.detail.n8":
		querybudgets.AssertQueryBudget(t, "api.groups.presence20.detail.n8", queries)
	default:
		t.Fatalf("unknown scenario %s N%d", scenario, n)
	}
}
