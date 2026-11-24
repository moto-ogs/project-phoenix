package api

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/analytics"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	"github.com/moto-ogs/project-phoenix/realtime"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestSupervisionContextRecoversFromSQLFailures(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	f := newSupervisionContextFixture(t)
	setSupervisionOverview(t, f, settings.OverviewScopeAllStaff)
	claims := testpkg.TenantUserTestClaims(int(f.account), f.school, permissions.GroupsRead, permissions.RoomsRead)
	token := testpkg.MintLiveSessionJWT(t, f.db, claims)
	config := ServeConfig{
		Port: "127.0.0.1:0", FrontendURL: "http://localhost:3000", PublicAPIURL: "http://localhost:8080",
		Process: ServeAPIOnly, Logger: slog.Default(),
		Turnstile: TurnstileKeys{SiteKey: "1x00000000000000000000AA", SecretKey: "1x0000000000000000000000000000000AA"},
	}
	hub := realtime.NewHub(config.Logger)
	t.Cleanup(hub.Drain)
	handler, _, _, err := composeProcess(config, testpkg.NewDatabase(t, db), analytics.NewNoop(), "", hub)
	require.NoError(t, err)
	counter := testpkg.CaptureQueriesForContext(t, db)
	actual := &goldenRuntime{handler: handler}
	read := func(t *testing.T) supervisiondashboard.NavigationContext {
		t.Helper()
		counter.Reset()
		response := supervisionContextRequest(actual.queryBudgetHandler(counter), supervisionContextURL, token)
		data := decodeSupervisionContext(t, response)
		assertSupervisionTransactions(t, counter.Queries())
		require.NotEmpty(t, counter.Matching(func(sql string) bool { return strings.HasPrefix(sql, "rollback to") }))
		require.Equal(t, supervisiondashboard.ContextOK, data.ReleasedRooms.Status)
		require.Len(t, data.ReleasedRooms.Items, 2)
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
		data := read(t)
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.Sessions.OverviewStatus)
		assertOwnSupervisionContext(t, f, data.Sessions)
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.Groups.Status, "groups use the same overview setting")
	})
	t.Run("own assignment SQL fails but authorized overview survives", func(t *testing.T) {
		failSelect(t, "active.group_supervisors", divisionByZero)
		data := read(t)
		require.Equal(t, supervisiondashboard.ContextOK, data.Groups.Status)
		require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OverviewStatus)
		require.Equal(t, supervisiondashboard.ContextUnavailable, data.Sessions.OwnStatus)
		require.Len(t, data.Sessions.Items, 2)
		for _, session := range data.Sessions.Items {
			require.Nil(t, session.IsOwn, "unknown assignment must not mean definitely not mine")
		}
	})
}
