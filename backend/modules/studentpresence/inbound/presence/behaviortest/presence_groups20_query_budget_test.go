package presence_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

func TestPresenceGroups20ActiveQueryBudget(t *testing.T) {
	t.Parallel()
	for _, key := range []string{"supervisors_all"} {
		t.Run(key, func(t *testing.T) {
			testpkg.OwnTenant(t)
			db := testpkg.SetupIsolatedTestDB(t)
			tc, active := setupProtectedRouter(t)
			require.Same(t, db, tc.db)
			router := chi.NewRouter()
			router.Use(testpkg.TenantRuntimeMiddleware(t, db))
			router.Mount("/api", active)
			_, account := testpkg.CreateTestStaffWithAccount(t, db, "Presence20", "Reader")
			claims := testutil.AdminTestClaimsForTenant(int(account.ID), testpkg.Tenant(t))
			token := testutil.MintTestJWT(t, claims)
			room := testpkg.CreateTestRoom(t, db, "Presence20Room")
			activity := testpkg.CreateTestActivityGroup(t, db, "Presence20Activity")
			// A running session of another school must stay out of the list.
			foreign := testpkg.NewTenantScope(t, db)
			testpkg.CreateTestActiveGroupForTenant(t, db, foreign.TenantID)
			var groups []*testpkg.ActiveGroupRow
			var expected []presenceAPI.ActiveGroupResponse
			counter := testpkg.CaptureQueries(t, db)
			counter.Stop()
			type sample struct {
				n   int
				sql testpkg.QueryMeasurement
			}
			var samples []sample
			for _, n := range []int{3, 8} {
				for len(groups) < n {
					i := len(groups)
					group := testpkg.CreateTestActiveGroup(t, db, activity.ID, room.ID)
					// The API renders stored instants in the database session zone.
					require.NoError(t, db.NewSelect().Model(group).WherePK().Scan(testpkg.Ctx(t)))
					groups = append(groups, group)
					row := presenceAPI.ActiveGroupResponse{ID: ident.ID(group.ID), GroupID: (*ident.ID)(&activity.ID), RoomID: ident.ID(room.ID), StartTime: group.StartTime.UTC(), IsActive: true, CreatedAt: group.CreatedAt.UTC(), UpdatedAt: group.UpdatedAt.UTC(), Room: &presenceAPI.RoomSimple{ID: ident.ID(room.ID), Name: room.Name}}
					if key == "supervisors_all" {
						staff := testpkg.CreateTestStaff(t, db, "Presence20", fmt.Sprintf("Supervisor%d", i))
						testpkg.CreateTestGroupSupervisor(t, db, staff.ID, group.ID, "supervisor")
						row.Supervisors = []presenceAPI.GroupSupervisorSimple{{StaffID: ident.ID(staff.ID), Role: "supervisor"}}
						row.SupervisorCount = 1
					}
					expected = append(expected, row)
				}
				path := "/api/active/supervisors/all"
				counter.Reset()
				counter.Start()
				rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, "GET", path, nil, testutil.WithJWTBearer(token)))
				counter.Stop()
				require.Equal(t, 200, rr.Code, rr.Body.String())
				require.Zero(t, counter.WriteRows())
				for _, op := range []string{"INSERT", "UPDATE", "DELETE", "MERGE"} {
					require.Empty(t, counter.Operation(op))
				}
				var envelope struct {
					Data json.RawMessage `json:"data"`
				}
				require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
				var got []presenceAPI.ActiveGroupResponse
				require.NoError(t, json.Unmarshal(envelope.Data, &got))
				for i := range got {
					got[i].StartTime = got[i].StartTime.UTC()
					got[i].CreatedAt = got[i].CreatedAt.UTC()
					got[i].UpdatedAt = got[i].UpdatedAt.UTC()
				}
				require.Equal(t, expected, got)
				t.Logf("PRESENCE20_ACTIVE key=%s n=%d statements=%d sql=%q body=%s", key, n, counter.Total(), counter.Queries(), rr.Body.String())
				samples = append(samples, sample{n, counter.Measurement(counter.Queries())})
				denied := testutil.ExecuteRequest(router, testutil.NewRequest("GET", path, nil))
				require.Equal(t, 401, denied.Code)
				wrong := claims
				wrong.Scope = "school"
				denied = testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, "GET", path, nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, wrong))))
				require.Equal(t, 401, denied.Code)
			}
			for _, s := range samples {
				t.Run(fmt.Sprintf("n%d", s.n), func(t *testing.T) { assertPresence20ActiveBudget(t, key, s.n, s.sql) })
			}
		})
	}
}

func assertPresence20ActiveBudget(t *testing.T, key string, n int, queries querybudgets.Measurement) {
	t.Helper()
	switch fmt.Sprintf("%s.n%d", key, n) {
	case "supervisors_all.n3":
		querybudgets.AssertQueryBudget(t, "api.active.presence20.supervisors_all.n3", queries)
	case "supervisors_all.n8":
		querybudgets.AssertQueryBudget(t, "api.active.presence20.supervisors_all.n8", queries)
	default:
		t.Fatalf("unknown key %s N%d", key, n)
	}
}
