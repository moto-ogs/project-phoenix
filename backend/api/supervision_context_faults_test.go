package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/grouplive"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	supervisionHTTP "github.com/moto-ogs/project-phoenix/modules/supervisiondashboard/http"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestSupervisionContextRecoversFromSQLFailures(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	f := newSupervisionContextFixture(t)
	setSupervisionOverview(t, f, settings.OverviewScopeAllStaff)
	claims := testpkg.TenantUserTestClaims(int(f.account), f.school, permissions.GroupsRead, permissions.RoomsRead)
	token := testpkg.MintTestJWT(t, claims)
	counter := testpkg.CaptureQueriesForContext(t, db)
	handler := supervisionFaultRouter(t, f, counter, nil)
	read := func(t *testing.T, query string) supervisiondashboard.NavigationContext {
		t.Helper()
		counter.Reset()
		response := supervisionContextRequest(handler, supervisionContextURL+query, token)
		data := decodeSupervisionContext(t, response)
		assertSupervisionSchoolTransaction(t, counter.Queries())
		require.NotEmpty(t, counter.Matching(func(sql string) bool { return strings.HasPrefix(sql, "rollback to") }))
		return data
	}

	// Restrictive policies on the isolated clone make PostgreSQL fail real
	// owner SELECTs while the role is phoenix_tenant. An aborted transaction
	// cannot even read the independent release list without a savepoint.
	failSelect := func(t *testing.T, table, expression string) {
		t.Helper()
		_, err := db.ExecContext(t.Context(), fmt.Sprintf("CREATE POLICY context_test_failure ON %s AS RESTRICTIVE FOR SELECT TO phoenix_tenant USING (%s)", table, expression))
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := db.ExecContext(context.Background(), "DROP POLICY context_test_failure ON "+table)
			require.NoError(t, err)
		})
	}
	const divisionByZero = "tenant_id / (tenant_id - tenant_id) = 1"
	t.Run("overview SQL fails but own sessions survive", func(t *testing.T) {
		failSelect(t, "config.setting_values", "CASE WHEN setting_key = 'operations.operational_overview_scope' THEN "+divisionByZero+" ELSE true END")
		data := read(t, "")
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.Sessions.OverviewStatus)
		assertOwnSupervisionContext(t, f, data.Sessions)
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.Groups.Status, "the fault rig also fails its groups reader on the unreadable setting")
		require.Equal(t, supervisiondashboard.ContextOK, data.ReleasedRooms.Status)
		require.Len(t, data.ReleasedRooms.Items, 2)
	})
	t.Run("own assignment SQL fails but authorized overview survives", func(t *testing.T) {
		failSelect(t, "active.group_supervisors", divisionByZero)
		data := read(t, "")
		require.Equal(t, supervisiondashboard.ContextOK, data.Groups.Status)
		require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OverviewStatus)
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.Sessions.OwnStatus)
		require.Len(t, data.Sessions.Items, 2)
		for _, session := range data.Sessions.Items {
			require.Nil(t, session.IsOwn, "unknown assignment must not mean definitely not mine")
		}
		setSupervisionOverview(t, f, settings.OverviewScopeOwn)
		requireUnavailableOwnSessions(t, read(t, "").Sessions)
	})
	t.Run("own session display SQL fails after assignment succeeded", func(t *testing.T) {
		setSupervisionOverview(t, f, settings.OverviewScopeOwn)
		failSelect(t, "facilities.rooms", divisionByZero)
		requireUnavailableOwnSessions(t, read(t, "?section=sessions").Sessions)
	})
	t.Run("released rooms SQL fails but groups survive", func(t *testing.T) {
		failSelect(t, "facilities.rooms", divisionByZero)
		data := read(t, "?section=released-rooms&section=groups")
		require.Equal(t, supervisiondashboard.ContextOK, data.Groups.Status)
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.ReleasedRooms.Status)
		require.Empty(t, data.ReleasedRooms.Items)
	})
	t.Run("savepoint control failure rolls back the request", func(t *testing.T) {
		handler := supervisionFaultRouter(t, f, counter, func(context.Context, func(context.Context) error) error {
			return tenant.ErrSavepointControl
		})
		counter.Reset()
		response := supervisionContextRequest(handler, supervisionContextURL, token)
		require.Equal(t, http.StatusInternalServerError, response.Code, response.Body.String())
		require.NotContains(t, response.Body.String(), `"released_rooms"`)
		require.Equal(t, "ROLLBACK", counter.Queries()[len(counter.Queries())-1])
	})
}

func requireUnavailableOwnSessions(t *testing.T, sessions *supervisiondashboard.ContextSessions) {
	t.Helper()
	require.Equal(t, supervisiondashboard.ContextForbidden, sessions.OverviewStatus)
	require.Equal(t, supervisiondashboard.ContextUnavailable, sessions.OwnStatus)
	require.Equal(t, supervisiondashboard.ContextUnavailable, sessions.Status)
	require.Empty(t, sessions.Items)
}

func supervisionFaultRouter(t *testing.T, f supervisionContextFixture, counter *testpkg.QueryCounter, savepoint func(context.Context, func(context.Context) error) error) http.Handler {
	t.Helper()
	database := testpkg.NewDatabase(t, f.db)
	settingsOwner, err := owners.NewSettingsTestModule(database, database.UnitOfWork())
	require.NoError(t, err)
	rooms, err := NewFacilities(database)
	require.NoError(t, err)
	logger := slog.Default()
	presence := owners.NewLoggedStudentPresence(database, logger)
	assignments, err := studentpresence.StaffSupervisionAssignmentsOf(presence)
	require.NoError(t, err)
	groups := func(ctx context.Context) (grouplive.NavigationContext, error) {
		_, err := settingsOwner.Settings.ResolveString(ctx, settings.KeyOperationalOverviewScope)
		return grouplive.NavigationContext{}, err
	}
	query := supervisionContextReader(groups, supervisionContextSessions{
		staffID:  func(context.Context) (int64, bool, error) { return f.staff.Int64(), true, nil },
		settings: settingsOwner.Settings, presence: presence, rooms: rooms, activities: supervisionFaultActivities{},
	}, assignments, logger)
	if savepoint != nil {
		query.Savepoint = savepoint
	}
	resource := supervisionHTTP.ContextResource{Read: query.SupervisionContext}
	router := chi.NewRouter()
	router.Use(common.ProblemResponseMiddleware, common.TenantRuntimeMiddleware(database.UnitOfWork()))
	router.Route("/api/active", func(r chi.Router) { ProtectedTenantRoutes(r, resource.Register) })
	verified := testpkg.SessionVerifier(router)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		verified.ServeHTTP(w, r.WithContext(counter.Context(r.Context())))
	})
}

type supervisionFaultActivities struct{}

func (supervisionFaultActivities) ListGroups(context.Context, timetable.GroupFilter) ([]timetable.Group, error) {
	return nil, nil
}
