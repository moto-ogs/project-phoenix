//go:build testhooks

package httpadapter_test

// The notice of a closed room (#8234), from outside: the Leitung closes a
// room through its route, Timetable names the staff planned there, and
// Delivery writes feed and push outbox in the same transaction. Each account
// reads its own feed through the routes of its portal.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	httpadapter "github.com/moto-ogs/project-phoenix/modules/facilities/http"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type roomClosureFeed struct {
	db     *bun.DB
	school int64
	call   roomClosureCall
	feed   chi.Router
}

func newRoomClosureFeed(t *testing.T, school int64, leitung int64) *roomClosureFeed {
	t.Helper()
	f := &roomClosureFeed{school: school}
	tc := setupRoomsRouteWith(t, func(dependencies *httpadapter.Dependencies) {
		db := testpkg.SetupTestDB(t)
		database, unit := testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db)
		module, err := api.NewDeliveryTestModule(database, unit)
		require.NoError(t, err)
		settings, err := owners.NewSettingsTestModule(database, unit)
		require.NoError(t, err)
		notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
		require.NoError(t, err)
		now := func() time.Time { return roomClosuresToday }
		closures, err := facilitiesCompose.NewClosures(facilitiesCompose.Dependencies{DB: db, Observe: func(facilitiesCompose.Observation) {}, Now: now})
		require.NoError(t, err)
		dependencies.Closures, err = api.NewNoticedRoomClosuresForTest(database, closures, notifier, module.NotificationPreferences, now)
		require.NoError(t, err)
		f.feed = module.NotificationPreferenceRouterForTests()
	})
	f.db = tc.db
	f.call = roomClosureCall{router: tc.router, claims: testutil.TenantUserTestClaims(int(leitung), school, "rooms:read", "rooms:update"), permissions: []string{"rooms:read", "rooms:update"}}
	// Equal bounds open the push window all day.
	testpkg.SetTestTenantSetting(t, f.db, school, "notifications.dispatch_enabled", `true`)
	testpkg.SetTestTenantSetting(t, f.db, school, "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, f.db, school, "notifications.active_window_end", `"06:00"`)
	return f
}

// staff creates a staff member of the school with a login account and a push
// device and answers staff and account.
func (f *roomClosureFeed) staff(t *testing.T, tenantID int64, name string) (int64, int64) {
	t.Helper()
	staff, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, tenantID, name, "Raumsperre")
	testpkg.GrantTestPermission(t, f.db, tenantID, account.ID, "activities:read")
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'staff', ?, 'test-p256dh', 'test-auth')`, tenantID, account.ID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/room-closure-%d", account.ID))
	require.NoError(t, err)
	return staff.ID, account.ID
}

// plan puts the staff member on a block in the room on the day.
func (f *roomClosureFeed) plan(t *testing.T, tenantID, roomID int64, day calendar.Date, staffID int64, opts testpkg.InstanceStaffOpts) int64 {
	t.Helper()
	block := testpkg.CreateTestActivityInstanceForTenant(t, f.db, tenantID, day, roomID, testpkg.ActivityInstanceOpts{Title: "Werken"})
	testpkg.CreateTestInstanceStaffForTenant(t, f.db, tenantID, block.ID, staffID, opts)
	return block.ID
}

type roomClosureFeedEntry struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	DeepLink string `json:"deep_link"`
}

func (f *roomClosureFeed) entries(t *testing.T, accountID, tenantID int64, scope string) []roomClosureFeedEntry {
	t.Helper()
	path := "/api/notifications/feed"
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = tenantID
	if scope == "parent" {
		claims, path = testutil.ParentTestClaims(int(accountID)), "/parent/me/notifications/feed"
	}
	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	rec := testutil.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var feed struct {
		Data struct {
			Entries []roomClosureFeedEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &feed))
	return feed.Data.Entries
}

func (f *roomClosureFeed) pushes(t *testing.T, accountID int64) int {
	t.Helper()
	count, err := f.db.NewSelect().TableExpr("platform.push_outbox").
		Where("(recipient->>'account_id')::bigint = ?", accountID).
		Where("payload->>'type' = ?", deliveryContract.NotificationRoomClosed).
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

// TestRoomClosureFeedReachesTheStaffPlannedInTheRoomOnly pins who hears of a
// closed room (#8234): the staff planned on a block in the room within the
// closure. Staff without a block there, with a block outside the days or in
// another room, an absent supervisor, the person who closed it, the families
// and another school hear nothing.
func TestRoomClosureFeedReachesTheStaffPlannedInTheRoomOnly(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	leitungStaff, leitung := testpkg.CreateTestStaffWithAccountForTenant(t, db, school, "Lea", "Leitung")
	f := newRoomClosureFeed(t, school, leitung.ID)
	werkraum := testpkg.CreateTestRoomForTenant(t, f.db, school, "Werkraum Feed")
	musik := testpkg.CreateTestRoomForTenant(t, f.db, school, "Musikraum Feed")
	inside := calendar.NewDate(2026, 12, 1)

	planned, plannedAccount := f.staff(t, school, "Pia")
	f.plan(t, school, werkraum.ID, inside, planned, testpkg.InstanceStaffOpts{IsPrimary: true})
	active, activeAccount := f.staff(t, school, "Ada")
	activeBlock := f.plan(t, school, werkraum.ID, inside, active, testpkg.InstanceStaffOpts{IsPrimary: true})
	testpkg.SetActivityInstanceLifecycle(t, testpkg.Ctx(t), f.db, activeBlock, timetable.InstanceStatusActive)
	later, laterAccount := f.staff(t, school, "Leo")
	f.plan(t, school, werkraum.ID, calendar.NewDate(2026, 12, 5), later, testpkg.InstanceStaffOpts{IsPrimary: true})
	elsewhere, elsewhereAccount := f.staff(t, school, "Elli")
	f.plan(t, school, musik.ID, inside, elsewhere, testpkg.InstanceStaffOpts{IsPrimary: true})
	absent, absentAccount := f.staff(t, school, "Abe")
	f.plan(t, school, werkraum.ID, inside, absent, testpkg.InstanceStaffOpts{IsAbsent: true})
	noActivities, noActivitiesAccount := f.staff(t, school, "Nora")
	f.plan(t, school, werkraum.ID, inside, noActivities, testpkg.InstanceStaffOpts{IsPrimary: true})
	_, err := f.db.ExecContext(testpkg.Ctx(t), `DELETE FROM auth.account_roles AS account_role
		USING auth.role_permissions AS role_permission, auth.permissions AS permission
		WHERE account_role.role_id = role_permission.role_id
		  AND role_permission.permission_id = permission.id
		  AND account_role.account_id = ?
		  AND account_role.tenant_id = ?
		  AND permission.name = 'activities:read'`, noActivitiesAccount, school)
	require.NoError(t, err)
	_, bystanderAccount := f.staff(t, school, "Udo")
	testpkg.GrantTestPermission(t, f.db, school, leitung.ID, "activities:read")
	f.plan(t, school, werkraum.ID, inside, leitungStaff.ID, testpkg.InstanceStaffOpts{})
	family := testpkg.CreateTestParentGuardianChain(t, f.db)

	foreign := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, f.db, foreign)
	foreignRoom := testpkg.CreateTestRoomForTenant(t, f.db, foreign, "Fremder Werkraum Feed")
	stranger, strangerAccount := f.staff(t, foreign, "Fremd")
	f.plan(t, foreign, foreignRoom.ID, inside, stranger, testpkg.InstanceStaffOpts{IsPrimary: true})

	rr := f.call.do(t, http.MethodPost, fmt.Sprintf("/%d/closures", werkraum.ID), closureBody("2026-11-30", "2026-12-02", "Wasserschaden."))
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())

	entries := f.entries(t, plannedAccount, school, "staff")
	require.Len(t, entries, 1)
	assert.Equal(t, deliveryContract.NotificationRoomClosed, entries[0].Type)
	assert.Equal(t, "Raum gesperrt", entries[0].Title)
	assert.Equal(t, "Der Raum „"+werkraum.Name+"“ ist vom 30.11.2026 bis 02.12.2026 gesperrt: Wasserschaden. Du hast in dieser Zeit dort einen Termin. Er bleibt in diesem Raum, bis die Leitung ihn verlegt.", entries[0].Body)
	assert.Equal(t, "/mein-dienstplan?d=2026-11-30", entries[0].DeepLink)
	assert.Equal(t, 1, f.pushes(t, plannedAccount), "the closure begins within 14 days")
	assert.Len(t, f.entries(t, activeAccount, school, "staff"), 1, "an active block still takes place in the room")
	assert.Equal(t, 1, f.pushes(t, activeAccount))

	assert.Empty(t, f.entries(t, laterAccount, school, "staff"), "a block after the closure is not concerned")
	assert.Empty(t, f.entries(t, elsewhereAccount, school, "staff"), "a block in another room is not concerned")
	assert.Empty(t, f.entries(t, absentAccount, school, "staff"), "an absent supervisor is not in the room")
	assert.Empty(t, f.entries(t, noActivitiesAccount, school, "staff"), "staff without activities:read cannot read the notice")
	assert.Empty(t, f.entries(t, bystanderAccount, school, "staff"), "staff without a block hear nothing")
	assert.Empty(t, f.entries(t, leitung.ID, school, "staff"), "who closed the room gets nothing")
	assert.Empty(t, f.entries(t, family.AccountID, 0, "parent"), "the families see no room closure")
	assert.Empty(t, f.entries(t, strangerAccount, foreign, "staff"), "another school hears nothing")
	assert.Empty(t, f.entries(t, plannedAccount, foreign, "staff"), "a session of another school shows nothing of this one")
	assert.Zero(t, f.pushes(t, laterAccount)+f.pushes(t, noActivitiesAccount)+f.pushes(t, bystanderAccount)+f.pushes(t, leitung.ID)+f.pushes(t, strangerAccount))
}

// TestRoomClosureFeedFollowsTheWindowAndTheSchoolSwitch: a closure that
// begins beyond 14 days reaches the feed only, and a school that switched
// the notice off writes neither feed entry nor push (#8234).
func TestRoomClosureFeedFollowsTheWindowAndTheSchoolSwitch(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	_, leitung := testpkg.CreateTestStaffWithAccountForTenant(t, db, school, "Lea", "Fenster")
	f := newRoomClosureFeed(t, school, leitung.ID)
	werkraum := testpkg.CreateTestRoomForTenant(t, f.db, school, "Werkraum Fenster")
	planned, plannedAccount := f.staff(t, school, "Pia")
	f.plan(t, school, werkraum.ID, calendar.NewDate(2026, 12, 20), planned, testpkg.InstanceStaffOpts{IsPrimary: true})

	rr := f.call.do(t, http.MethodPost, fmt.Sprintf("/%d/closures", werkraum.ID), closureBody("2026-12-20", "2026-12-20", "Malerarbeiten"))
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	entries := f.entries(t, plannedAccount, school, "staff")
	require.Len(t, entries, 1)
	assert.Contains(t, entries[0].Body, "ist am 20.12.2026 gesperrt: Malerarbeiten.")
	assert.Zero(t, f.pushes(t, plannedAccount), "beyond 14 days the feed only")

	testpkg.SetTestTenantSetting(t, f.db, school, "notifications.room_closed_enabled", `false`)
	musik := testpkg.CreateTestRoomForTenant(t, f.db, school, "Musikraum Fenster")
	f.plan(t, school, musik.ID, calendar.NewDate(2026, 11, 26), planned, testpkg.InstanceStaffOpts{IsPrimary: true})
	rr = f.call.do(t, http.MethodPost, fmt.Sprintf("/%d/closures", musik.ID), closureBody("2026-11-26", "2026-11-26", "Probe"))
	require.Equal(t, http.StatusCreated, rr.Code, rr.Body.String())
	assert.Len(t, f.entries(t, plannedAccount, school, "staff"), 1, "the switched-off school writes no new entry")
	assert.Zero(t, f.pushes(t, plannedAccount))
}
