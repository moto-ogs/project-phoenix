package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

const supervisionContextURL = "/api/active/supervision-context"

type supervisionContextFixture struct {
	db                     *testpkg.DB
	school                 int64
	staff                  ident.ID
	account                int64
	ownGroup, substitution ident.ID
	unassignedGroup        ident.ID
	ownRoom, yard          ident.ID
	ownSession, another    ident.ID
	activityName           string
	foreignSchool          int64
	foreignSession         ident.ID
	foreignGroup           ident.ID
	foreignRoom            ident.ID
}

func newSupervisionContextFixture(t *testing.T) supervisionContextFixture {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	teacher, account := testpkg.CreateTestTeacherWithAccount(t, db, "Aufsicht", "Leitung")
	room := testpkg.CreateTestOpenRoom(t, db, "Werkraum")
	yard := testpkg.CreateTestSystemRoom(t, db, "Schulhof", true)
	testpkg.CreateTestSystemRoom(t, db, "WC", true)
	testpkg.CreateTestSystemRoom(t, db, "Infrastruktur", true)
	archived := testpkg.CreateTestOpenRoom(t, db, "Archivierter Raum")
	_, err := db.NewUpdate().Table("facilities.rooms").Set("archived_at = now()").Where("id = ?", archived.ID).Exec(t.Context())
	require.NoError(t, err)
	group := testpkg.CreateTestEducationGroup(t, db, "Otter")
	substitution := testpkg.CreateTestEducationGroup(t, db, "Igel")
	unassignedGroup := testpkg.CreateTestEducationGroup(t, db, "Seesterne")
	testpkg.SetEducationGroupRoom(t, db, group.ID, &room.ID)
	testpkg.SetEducationGroupRoom(t, db, substitution.ID, &yard.ID)
	testpkg.CreateTestGroupTeacher(t, db, group.ID, teacher.ID)
	today := calendar.TodayDate()
	testpkg.CreateTestGroupSubstitution(t, db, substitution.ID, nil, teacher.StaffID, today, today.AddDays(1))
	activity := testpkg.CreateTestActivityGroup(t, db, "Werken")
	own := testpkg.CreateTestActiveGroup(t, db, activity.ID, room.ID)
	second := testpkg.CreateTestActiveGroup(t, db, activity.ID, room.ID)
	testpkg.CreateTestGroupSupervisor(t, db, teacher.StaffID, own.ID, "supervisor")
	testpkg.CreateTestGroupSupervisorOn(t, db, teacher.StaffID, second.ID, "supervisor", today.AddDays(1))
	ended := testpkg.CreateTestEndedActiveGroup(t, db, "Aufsicht")
	testpkg.CreateTestGroupSupervisor(t, db, teacher.StaffID, ended.GroupID, "supervisor")

	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	foreignGroup := testpkg.CreateTestEducationGroupForTenant(t, db, otherSchool, "Fremde Gruppe")
	foreign := testpkg.CreateTestActiveGroupForTenant(t, db, otherSchool)
	foreignRoom := testpkg.CreateTestOpenRoomForTenant(t, db, otherSchool, "Fremder Raum")
	return supervisionContextFixture{
		db: db, school: school, staff: ident.ID(teacher.StaffID), account: account.ID,
		ownGroup: ident.ID(group.ID), substitution: ident.ID(substitution.ID), unassignedGroup: ident.ID(unassignedGroup.ID), ownRoom: ident.ID(room.ID), yard: ident.ID(yard.ID),
		ownSession: ident.ID(own.ID), another: ident.ID(second.ID), activityName: activity.Name, foreignSession: ident.ID(foreign.ID),
		foreignSchool: otherSchool, foreignGroup: ident.ID(foreignGroup.ID), foreignRoom: ident.ID(foreignRoom.ID),
	}
}

func checkSupervisionContext(t *testing.T, api *goldenRuntime) {
	t.Helper()
	t.Parallel()
	f := newSupervisionContextFixture(t)
	claims := testpkg.TenantUserTestClaims(int(f.account), f.school, permissions.GroupsRead, permissions.RoomsRead)
	token := testpkg.MintLiveSessionJWT(t, f.db, claims)
	setSupervisionOverview(t, f, settings.OverviewScopeOwn)
	checkSupervisionContextAccess(t, api, f, claims, token)
	checkSupervisionContextTenantIsolation(t, api, f, token)
	checkSupervisionContextBudget(t, api, f, token)
	checkSupervisionContextEmptyOverview(t, api, f, token)
}

func checkSupervisionContextTenantIsolation(t *testing.T, api *goldenRuntime, f supervisionContextFixture, token string) {
	t.Helper()
	foreignClaims := testpkg.AdminTestClaimsForTenant(int(f.account), f.foreignSchool)
	foreignToken := testpkg.MintLiveSessionJWT(t, f.db, foreignClaims)
	foreign := decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, foreignToken))
	require.Len(t, foreign.Groups.Navigation, 1)
	require.Equal(t, f.foreignGroup, foreign.Groups.Navigation[0].ID)
	require.Len(t, foreign.Sessions.Items, 1)
	require.Equal(t, f.foreignSession, foreign.Sessions.Items[0].ID)
	require.Len(t, foreign.ReleasedRooms.Items, 1)
	require.Equal(t, f.foreignRoom, foreign.ReleasedRooms.Items[0].ID)

	spoofed := fmt.Sprintf("%s?tenant_id=%d&session_id=%d", supervisionContextURL, f.foreignSchool, f.foreignSession)
	local := decodeSupervisionContext(t, supervisionContextRequest(api, spoofed, token))
	require.Len(t, local.Groups.Navigation, 3)
	require.Len(t, local.Sessions.Items, 2)
	require.Len(t, local.ReleasedRooms.Items, 2)
	foreignToCaller := slices.IndexFunc(local.Groups.Navigation, func(group supervisiondashboard.ContextNavigationGroup) bool {
		return group.ID == f.unassignedGroup
	})
	require.NotEqual(t, -1, foreignToCaller)
	require.False(t, local.Groups.Navigation[foreignToCaller].IsPersonal)
	for _, group := range local.Groups.Navigation {
		require.NotEqual(t, f.foreignGroup, group.ID)
	}
	for _, session := range local.Sessions.Items {
		require.NotEqual(t, f.foreignSession, session.ID)
	}
	for _, room := range local.ReleasedRooms.Items {
		require.NotEqual(t, f.foreignRoom, room.ID)
	}
}

func checkSupervisionContextEmptyOverview(t *testing.T, api *goldenRuntime, f supervisionContextFixture, token string) {
	t.Helper()
	_, err := f.db.NewUpdate().Table("active.groups").Set("end_time = now()").Where("tenant_id = ? AND end_time IS NULL", f.school).Exec(t.Context())
	require.NoError(t, err)
	sessions := decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL+"?section=sessions", token)).Sessions
	require.Equal(t, supervisiondashboard.ContextOK, sessions.OverviewStatus)
	require.Equal(t, supervisiondashboard.ContextOK, sessions.OwnStatus)
	require.Equal(t, []supervisiondashboard.ContextSession{}, sessions.Items)
}

func checkSupervisionContextAccess(t *testing.T, api *goldenRuntime, f supervisionContextFixture, claims sessiontoken.AppClaims, token string) {
	t.Helper()
	r := supervisionContextRequest(api, supervisionContextURL, token)
	data := decodeSupervisionContext(t, r)
	require.Equal(t, supervisiondashboard.ContextOK, data.Groups.Status)
	require.ElementsMatch(t, []ident.ID{f.ownGroup, f.substitution}, data.Groups.OwnGroupIDs)
	require.Len(t, data.Groups.OwnRoomNames, 2)
	for _, group := range data.Groups.Navigation {
		switch group.ID {
		case f.ownGroup:
			require.True(t, group.IsPersonal)
			require.False(t, group.ViaSubstitution)
			require.Equal(t, f.ownRoom, *group.RoomID)
			require.NotEmpty(t, group.RoomName)
			require.NotEmpty(t, group.Leaders)
		case f.substitution:
			require.True(t, group.IsPersonal)
			require.True(t, group.ViaSubstitution)
		}
	}
	require.Len(t, data.Groups.Navigation, 2)
	require.Equal(t, supervisiondashboard.ContextForbidden, data.Sessions.OverviewStatus)
	assertOwnSupervisionContext(t, f, data.Sessions)
	require.Equal(t, supervisiondashboard.ContextOK, data.ReleasedRooms.Status)
	var roomIDs []ident.ID
	for _, room := range data.ReleasedRooms.Items {
		roomIDs = append(roomIDs, room.ID)
	}
	require.ElementsMatch(t, []ident.ID{f.ownRoom, f.yard}, roomIDs)

	setSupervisionOverview(t, f, settings.OverviewScopeAllStaff)
	sessions := decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL+"?section=sessions", token)).Sessions
	require.Equal(t, supervisiondashboard.ContextOK, sessions.OverviewStatus)
	require.Equal(t, supervisiondashboard.ContextOK, sessions.OwnStatus)
	require.ElementsMatch(t, []supervisiondashboard.ContextSession{
		{ID: f.ownSession, RoomID: f.ownRoom, RoomName: data.Sessions.Items[0].RoomName, ActivityName: f.activityName, IsOwn: new(true)},
		{ID: f.another, RoomID: f.ownRoom, RoomName: data.Sessions.Items[0].RoomName, ActivityName: f.activityName, IsOwn: new(false)},
	}, sessions.Items)

	checkSupervisionContextRoleLimits(t, api, f, claims)
	checkSupervisionContextSessionsAndPortals(t, api, f, claims)
}

func checkSupervisionContextRoleLimits(t *testing.T, api *goldenRuntime, f supervisionContextFixture, claims sessiontoken.AppClaims) {
	t.Helper()
	limited := claims
	limited.Permissions = []string{permissions.GroupsRead}
	data := decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, testpkg.MintLiveSessionJWT(t, f.db, limited)))
	require.Equal(t, supervisiondashboard.ContextForbidden, data.ReleasedRooms.Status)
	require.Empty(t, data.ReleasedRooms.Items)
	require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OverviewStatus)
	limited.Permissions = []string{permissions.RoomsRead}
	data = decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, testpkg.MintLiveSessionJWT(t, f.db, limited)))
	require.Equal(t, supervisiondashboard.ContextForbidden, data.Sessions.OverviewStatus)
	assertOwnSupervisionContext(t, f, data.Sessions)
	require.Equal(t, supervisiondashboard.ContextOK, data.ReleasedRooms.Status)

	noProfile := testpkg.CreateTestAccount(t, f.db, "aufsicht-admin@example.test")
	admin := testpkg.AdminTestClaimsForTenant(int(noProfile.ID), f.school)
	setSupervisionOverview(t, f, settings.OverviewScopeOwn)
	data = decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, testpkg.MintLiveSessionJWT(t, f.db, admin)))
	require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OverviewStatus)
	require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OwnStatus)
	require.Len(t, data.Sessions.Items, 2)
	for _, session := range data.Sessions.Items {
		require.Equal(t, new(false), session.IsOwn)
	}

	guest := claims
	guest.Permissions = systemRolePermissions(t, f.db, identityaccess.GuestRoleName)
	guest.Roles = []string{identityaccess.GuestRoleName}
	guestToken := testpkg.MintLiveSessionJWT(t, f.db, guest)
	data = decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, guestToken))
	require.Equal(t, supervisiondashboard.ContextForbidden, data.Sessions.OverviewStatus)
	assertOwnSupervisionContext(t, f, data.Sessions)
	setSupervisionOverview(t, f, settings.OverviewScopeAllStaff)
	data = decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, guestToken))
	require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OverviewStatus, "canonical all_staff uses a verified profile and groups:read, not the role label")
	guest.ID = int(noProfile.ID)
	data = decodeSupervisionContext(t, supervisionContextRequest(api, supervisionContextURL, testpkg.MintLiveSessionJWT(t, f.db, guest)))
	require.Equal(t, supervisiondashboard.ContextForbidden, data.Sessions.OverviewStatus)
	require.Equal(t, supervisiondashboard.ContextOK, data.Sessions.OwnStatus)
	require.Empty(t, data.Sessions.Items)
}

func checkSupervisionContextSessionsAndPortals(t *testing.T, api *goldenRuntime, f supervisionContextFixture, claims sessiontoken.AppClaims) {
	t.Helper()
	expired := claims
	expired.FamilyID = testpkg.CreateTestSessionFamily(t, f.db, f.account, f.school, "")
	_, err := f.db.NewUpdate().Table("auth.tokens").Set("expiry = ?", time.Now().Add(-time.Minute)).Where("family_id = ?", expired.FamilyID).Exec(t.Context())
	require.NoError(t, err)
	school := claims
	school.Scope = tenant.ScopeSchool
	school.IsAdmin = true
	school.Permissions = []string{"admin:*", permissions.GroupsRead}
	parent := claims
	parent.Scope, parent.TenantID = tenant.ScopeParent, 0
	platform := claims
	platform.Scope, platform.TenantID, platform.OrgID = tenant.ScopePlatform, 0, 0
	for name, token := range map[string]string{
		"no token": "", "expired family": testpkg.MintTestJWT(t, expired), "assignment-bound school": testpkg.MintLiveSessionJWT(t, f.db, school),
		"parent": testpkg.MintLiveSessionJWT(t, f.db, parent), "unbound operator": testpkg.MintTestJWT(t, platform),
	} {
		t.Run(name, func(t *testing.T) {
			counter := testpkg.CaptureQueriesForContext(t, api.db.Pool())
			response := supervisionContextRequest(api.queryBudgetHandler(counter), supervisionContextURL, token)
			require.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
			for _, statement := range counter.Queries() {
				require.NotContains(t, statement, "'phoenix_tenant'", "no school transaction for wrong or dead sessions")
			}
			if name == "unbound operator" {
				require.Empty(t, counter.Queries(), "the tenant gate alone would have delegated to the admin path")
			}
		})
	}
	for _, query := range []string{"?section=", "?section=groups&section=invalid", "?section=groups,sessions", "?section=groups;section=sessions"} {
		response := supervisionContextRequest(api, supervisionContextURL+query, testpkg.MintLiveSessionJWT(t, f.db, claims))
		require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	}
}

func assertOwnSupervisionContext(t *testing.T, f supervisionContextFixture, sessions *supervisiondashboard.ContextSessions) {
	t.Helper()
	require.Equal(t, supervisiondashboard.ContextOK, sessions.Status)
	require.Equal(t, supervisiondashboard.ContextOK, sessions.OwnStatus)
	require.Len(t, sessions.Items, 1)
	require.Equal(t, f.ownSession, sessions.Items[0].ID)
	require.Equal(t, f.ownRoom, sessions.Items[0].RoomID)
	require.NotEmpty(t, sessions.Items[0].RoomName)
	require.Equal(t, new(true), sessions.Items[0].IsOwn)
}

func setSupervisionOverview(t *testing.T, f supervisionContextFixture, scope string) {
	t.Helper()
	testpkg.SetTestTenantSetting(t, f.db, f.school, settings.KeyOperationalOverviewScope, fmt.Sprintf("%q", scope))
}

func supervisionContextRequest(handler http.Handler, path, token string) *httptest.ResponseRecorder {
	return checkpointRequest(handler, checkpointScenario{Method: http.MethodGet, Path: path, Authenticated: token != ""}, token)
}

func decodeSupervisionContext(t *testing.T, response *httptest.ResponseRecorder) supervisiondashboard.NavigationContext {
	t.Helper()
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var result struct {
		Data supervisiondashboard.NavigationContext
	}
	require.NoError(t, wire.Unmarshal(response.Body.Bytes(), &result))
	return result.Data
}

func checkSupervisionContextBudget(t *testing.T, api *goldenRuntime, f supervisionContextFixture, token string) {
	t.Helper()
	counter := testpkg.CaptureQueriesForContext(t, api.db.Pool())
	handler := api.queryBudgetHandler(counter)
	measure := func(path string) (*httptest.ResponseRecorder, []string) {
		counter.Reset()
		res := supervisionContextRequest(handler, path, token)
		require.Equal(t, http.StatusOK, res.Code, res.Body.String())
		return res, counter.Queries()
	}
	legacyPaths := []string{"/api/students/ogs-group-navigation", "/api/me/groups/supervised", "/api/rooms/?is_open_room=true", "/api/active/supervisors/all"}
	small := map[string]int{}
	for _, size := range []string{"small", "large"} {
		if size == "large" {
			growSupervisionContextFixture(t, f)
		}
		for _, scope := range []string{settings.OverviewScopeOwn, settings.OverviewScopeAllStaff} {
			setSupervisionOverview(t, f, scope)
			paths := legacyPaths[:3]
			if scope == settings.OverviewScopeAllStaff {
				paths = legacyPaths
			}
			var oldBytes, oldStatements int
			for _, path := range paths {
				response, queries := measure(path)
				assertSupervisionTransactions(t, queries)
				oldBytes += response.Body.Len()
				oldStatements += len(queries)
			}
			response, queries := measure(supervisionContextURL)
			assertSupervisionTransactions(t, queries)
			measurement := counter.Measurement(queries)
			if scope == settings.OverviewScopeOwn {
				querybudgets.AssertQueryBudget(t, "api.active.supervision_context.own", measurement)
			} else {
				querybudgets.AssertQueryBudget(t, "api.active.supervision_context.all_staff", measurement)
			}
			require.Less(t, response.Body.Len(), oldBytes)
			require.Less(t, len(queries), oldStatements)
			if size == "small" {
				small[scope] = len(queries)
			} else {
				require.Equal(t, small[scope], len(queries), "batch statement count must stay flat")
				data := decodeSupervisionContext(t, response)
				require.Len(t, data.ReleasedRooms.Items, 54)
				require.Len(t, data.Groups.OwnGroupIDs, 14)
				wantSessions := 13
				if scope == settings.OverviewScopeAllStaff {
					wantSessions++
				}
				require.Len(t, data.Sessions.Items, wantSessions)
			}
			t.Logf("%s %s: requests %d → 1; transactions %d → 2; statements %d → %d; body bytes %d → %d", size, scope, len(paths), len(paths)*2, oldStatements, len(queries), oldBytes, response.Body.Len())
		}
	}
	checkSupervisionContextSections(t, f, counter, measure)
}

func growSupervisionContextFixture(t *testing.T, f supervisionContextFixture) {
	t.Helper()
	for i := range 52 {
		room := testpkg.CreateTestOpenRoom(t, f.db, fmt.Sprintf("Raum %02d", i))
		if i < 12 {
			group := testpkg.CreateTestEducationGroup(t, f.db, fmt.Sprintf("Gruppe %02d", i))
			testpkg.SetEducationGroupRoom(t, f.db, group.ID, &room.ID)
			today := calendar.TodayDate()
			testpkg.CreateTestGroupSubstitution(t, f.db, group.ID, nil, f.staff.Int64(), today, today.AddDays(1))
			activity := testpkg.CreateTestActivityGroup(t, f.db, fmt.Sprintf("Angebot %02d", i))
			session := testpkg.CreateTestActiveGroup(t, f.db, activity.ID, room.ID)
			testpkg.CreateTestGroupSupervisor(t, f.db, f.staff.Int64(), session.ID, "supervisor")
		}
	}
}

func checkSupervisionContextSections(t *testing.T, f supervisionContextFixture, counter *testpkg.QueryCounter, measure func(string) (*httptest.ResponseRecorder, []string)) {
	t.Helper()
	for _, tc := range []struct {
		sections string
		groups   bool
		sessions bool
		rooms    bool
	}{
		{sections: "groups", groups: true},
		{sections: "sessions", sessions: true},
		{sections: "released-rooms", rooms: true},
		{sections: "sessions&section=groups&section=sessions", groups: true, sessions: true},
	} {
		r, queries := measure(supervisionContextURL + "?section=" + tc.sections)
		assertSupervisionTransactions(t, queries)
		measurement := counter.Measurement(queries)
		switch tc.sections {
		case "groups":
			querybudgets.AssertQueryBudget(t, "api.active.supervision_context.groups", measurement)
		case "sessions":
			querybudgets.AssertQueryBudget(t, "api.active.supervision_context.sessions", measurement)
		case "released-rooms":
			querybudgets.AssertQueryBudget(t, "api.active.supervision_context.released_rooms", measurement)
		default:
			querybudgets.AssertQueryBudget(t, "api.active.supervision_context.groups_sessions", measurement)
		}
		data := decodeSupervisionContext(t, r)
		require.Equal(t, tc.groups, data.Groups != nil)
		require.Equal(t, tc.sessions, data.Sessions != nil)
		require.Equal(t, tc.rooms, data.ReleasedRooms != nil)
		if tc.sessions {
			for _, session := range data.Sessions.Items {
				require.NotEqual(t, f.foreignSession, session.ID)
			}
		}
		containsSQL := func(fragment string) bool {
			return slices.ContainsFunc(queries, func(sql string) bool {
				return strings.Contains(strings.ReplaceAll(strings.ToLower(sql), `"`, ""), fragment)
			})
		}
		require.Equal(t, tc.groups, containsSQL("education.groups"), "groups SQL follows the selection: %q", queries)
		require.Equal(t, tc.sessions, containsSQL("active.group_supervisors"), "session SQL follows the selection: %q", queries)
		require.Equal(t, tc.rooms, containsSQL("is_open_room = true"), "release SQL follows the selection: %q", queries)
		t.Logf("section=%s: %d statements", tc.sections, len(queries))
	}
}

func assertSupervisionTransactions(t *testing.T, statements []string) {
	t.Helper()
	routeSQL := withoutSessionCheck(t, statements)
	begins := 0
	for _, statement := range routeSQL {
		if statement == "BEGIN" {
			begins++
		}
	}
	require.Equal(t, 1, begins, "one school transaction")
	require.Equal(t, "BEGIN", routeSQL[0])
	require.Equal(t, "COMMIT", routeSQL[len(routeSQL)-1])
	require.Contains(t, routeSQL[1], "set_config('role', 'phoenix_tenant', true)")
	require.Contains(t, routeSQL[1], "app.current_tenant_id")
	require.NotContains(t, strings.Join(routeSQL, "\n"), "SET LOCAL ROLE phoenix_admin")
}
