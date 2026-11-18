//go:build testhooks

package mealplan_test

// Der geänderte Speiseplan im Benachrichtigungs-Feed der Eltern (#7145), von
// außen geprüft: die Schule ändert den Speiseplan über die Route des
// Staff-Portals, Delivery schreibt Feed und Push-Outbox in derselben
// Transaktion, und jedes Elternkonto liest seinen Feed über die Routen des
// Elternportals.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// menuChangeToday pins the Meal Plan's day, a Monday: the relevance window
// and the ordering deadlines count from it.
var menuChangeToday = calendar.NewDate(2030, 6, 10)

const menuChangeType = "meal_plan_changed"

type menuChangeFixture struct {
	db       *bun.DB
	tenantID int64
	meals    chi.Router
	feed     chi.Router
	staffID  int64
	consent  func(accountID int64)
	settings interface {
		SetValue(ctx context.Context, key string, value any, changedBy *int64, permissions []string) error
	}
}

func newMenuChangeFixture(t *testing.T) *menuChangeFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	database := testpkg.NewDatabase(t, db)
	unit := testpkg.TenantRuntime(t, db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	people := api.NewPeopleRepositorySuiteFactory(database)
	directory := owners.MustNewPeopleDirectory(database)
	notices := owners.NewMealPlanChangeNotices(directory, owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences})
	require.NotNil(t, notices)
	now := func() time.Time { return menuChangeToday.BerlinMidnight().Add(10 * time.Hour) }
	meals, err := owners.BuildMealPlanAtForTests(database, settings.Settings, owners.NewStudentRootReads(people.Student), directory, notices, now)
	require.NoError(t, err)

	ctx := testpkg.Ctx(t)
	require.NoError(t, settings.Settings.SetValue(ctx, settingsModule.KeyMealPlanEnabled, true, nil, nil))
	require.NoError(t, settings.Settings.SetValue(ctx, settingsModule.KeyMealRegistrationEnabled, true, nil, nil))
	testpkg.SetTestTenantSetting(t, db, tenantID, settingsModule.KeyNotificationsDispatchEnabled, `true`)
	// Equal bounds open the push window all day, so the test does not depend
	// on the wall clock it runs at.
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.active_window_end", `"06:00"`)

	consent := api.NewNotificationConsentTestStore(database)
	f := &menuChangeFixture{
		db: db, tenantID: tenantID, settings: settings.Settings,
		meals: api.NewMealPlanResourceForTests(meals).Router(),
		feed:  module.NotificationPreferenceRouterForTests(),
		consent: func(accountID int64) {
			require.NoError(t, testpkg.TenantCommand3(t, testpkg.Ctx(t), db, consent.RecordConsent, accountID, menuChangeType, true))
		},
	}
	_, staff := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Küche", "Leitung")
	f.staffID = staff.ID
	return f
}

// family is a guardian with parent_portal.access to a child in care since
// 2030, a parents-portal device, and, when booked, meals on every weekday.
func (f *menuChangeFixture) family(t *testing.T, booked bool) testpkg.ParentChain {
	t.Helper()
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	from := calendar.NewDate(2030, 1, 1)
	testpkg.SetStudentLifecycle(t, f.db, chain.StudentID, "active", &from, nil)
	if booked {
		_, err := f.db.ExecContext(context.Background(), `INSERT INTO schedule.meal_participation_schedules
			(tenant_id, student_id, effective_from, monday, tuesday, wednesday, thursday, friday, changed_by_account_id)
			VALUES (?, ?, ?, true, true, true, true, true, ?)`, chain.TenantID, chain.StudentID, from, chain.AccountID)
		require.NoError(t, err)
	}
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'parent', ?, 'test-p256dh', 'test-auth')`, chain.TenantID, chain.AccountID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/meal-%d", chain.AccountID))
	require.NoError(t, err)
	return chain
}

// setMenu saves the dishes of a day through the school's route.
func (f *menuChangeFixture) setMenu(t *testing.T, date string, dishes ...string) {
	t.Helper()
	items := make([]string, 0, len(dishes))
	for _, dish := range dishes {
		items = append(items, fmt.Sprintf(`{"dish":%q}`, dish))
	}
	req := httptest.NewRequest(http.MethodPut, "/"+date, strings.NewReader(`{"dishes":[`+strings.Join(items, ",")+`]}`))
	req.Header.Set("Content-Type", "application/json")
	f.mealRequest(t, req)
}

func (f *menuChangeFixture) clearMenu(t *testing.T, date string) {
	t.Helper()
	f.mealRequest(t, httptest.NewRequest(http.MethodDelete, "/"+date, nil))
}

func (f *menuChangeFixture) mealRequest(t *testing.T, req *http.Request) {
	t.Helper()
	f.mealRequestAs(t, req, f.staffID)
}

func (f *menuChangeFixture) mealRequestAs(t *testing.T, req *http.Request, accountID int64) {
	t.Helper()
	claims := routetest.DefaultTestClaims()
	claims.ID = int(accountID)
	claims.Roles = []string{"user"}
	claims.IsAdmin = false
	claims.TenantID = f.tenantID
	rec := routetest.ExecuteWithAuthPermissions(t, testpkg.MountedQueryBudgetRouter("/api/meal-plan", f.meals), req, claims, []string{"admin:*"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

type menuChangeEntry struct {
	ID       int64   `json:"id"`
	Type     string  `json:"type"`
	Title    string  `json:"title"`
	Body     string  `json:"body"`
	DeepLink string  `json:"deep_link"`
	ReadAt   *string `json:"read_at"`
}

func (f *menuChangeFixture) entries(t *testing.T, accountID int64) []menuChangeEntry {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/parent/me/notifications/feed", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, testutil.ParentTestClaims(int(accountID)))))
	response := testutil.ExecuteRequestForTest(t, f.feed, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var feed struct {
		Data struct {
			Entries []menuChangeEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &feed))
	return feed.Data.Entries
}

// pushes returns title and body of the account's menu change pushes.
func (f *menuChangeFixture) pushes(t *testing.T, accountID int64) []string {
	t.Helper()
	var texts []string
	require.NoError(t, f.db.NewRaw(`SELECT concat_ws(' | ', payload->>'title', payload->>'body') FROM platform.push_outbox
		WHERE (recipient->>'account_id')::bigint = ? AND payload->>'type' = ?`, accountID, menuChangeType).Scan(context.Background(), &texts))
	return texts
}

func (f *menuChangeFixture) setAccess(t *testing.T, chain testpkg.ParentChain, permissions string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = ?::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`,
		permissions, chain.GuardianProfileID)
	require.NoError(t, err)
}

func (f *menuChangeFixture) setPortalLocale(t *testing.T, accountID int64, locale string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `UPDATE users.guardian_profiles SET portal_locale = ?
		WHERE tenant_id = ? AND account_id = ?`, locale, f.tenantID, accountID)
	require.NoError(t, err)
}

func TestMenuChangeReachesGuardiansWithABookingAndRights(t *testing.T) {
	t.Parallel()
	f := newMenuChangeFixture(t)
	booked, pushed := f.family(t, true), f.family(t, true)
	english := f.family(t, true)
	f.setPortalLocale(t, english.AccountID, "en")
	unbooked, withoutRights := f.family(t, false), f.family(t, true)
	f.setAccess(t, withoutRights, `{}`)
	f.consent(pushed.AccountID)

	// A guardian of another school whose child eats there on the same day.
	var otherSchool testpkg.ParentChain
	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		otherSchool = f.family(t, true)
	})

	// Publishing the menu of an empty day is the regular plan, no change.
	f.setMenu(t, "2030-06-12", "Nudeln mit Tomatensoße")
	assert.Empty(t, f.entries(t, booked.AccountID), "the first menu of a day is no change")
	// Saving the same menu again changes nothing either.
	f.setMenu(t, "2030-06-12", "Nudeln mit Tomatensoße")
	assert.Empty(t, f.entries(t, booked.AccountID), "an unchanged menu tells nobody")

	f.setMenu(t, "2030-06-12", "Reis mit Gemüse")

	for _, family := range []testpkg.ParentChain{booked, pushed} {
		entries := f.entries(t, family.AccountID)
		require.Len(t, entries, 1)
		assert.Equal(t, menuChangeType, entries[0].Type)
		assert.Equal(t, "Speiseplan geändert", entries[0].Title)
		assert.Equal(t, "Der Speiseplan für die Woche vom 10.06. bis 14.06.2030 hat sich geändert. Bitte prüfe, ob die Essensbuchung deines Kindes noch passt.", entries[0].Body)
		assert.Equal(t, fmt.Sprintf("/meal-plan?week=2030-06-10&school=%d", f.tenantID), entries[0].DeepLink)
		assert.Nil(t, entries[0].ReadAt)
	}
	entries := f.entries(t, english.AccountID)
	require.Len(t, entries, 1)
	assert.Equal(t, "Meal plan changed", entries[0].Title)
	assert.Equal(t, "The meal plan for the week from 10.06. to 14.06.2030 has changed. Please check whether your child's meal booking is still correct.", entries[0].Body)
	assert.Empty(t, f.entries(t, unbooked.AccountID), "a guardian without a booking gets nothing")
	assert.Empty(t, f.entries(t, withoutRights.AccountID), "a guardian without parent_portal.access gets nothing")
	assert.Empty(t, f.entries(t, otherSchool.AccountID), "another school sees nothing")

	// The push is off until the guardian switches it on, and it names no
	// child and no dish on the lock screen.
	assert.Empty(t, f.pushes(t, booked.AccountID), "the push is off by default")
	pushes := f.pushes(t, pushed.AccountID)
	require.Len(t, pushes, 1)
	assert.Equal(t, "Speiseplan geändert | Der Speiseplan hat sich geändert. Bitte prüfe die Essensbuchung im Elternportal.", pushes[0])
	for _, leak := range []string{"Felix", "Schneider", "Reis"} {
		assert.NotContains(t, pushes[0], leak)
	}
	assert.Empty(t, f.pushes(t, withoutRights.AccountID))

	// A second change of the same week within ten minutes updates the unread
	// entry without a second push; removing a day's menu is a change too.
	f.setMenu(t, "2030-06-13", "Linsensuppe")
	f.clearMenu(t, "2030-06-13")
	require.Len(t, f.entries(t, pushed.AccountID), 1, "changes to one week bundle into one entry")
	assert.Len(t, f.pushes(t, pushed.AccountID), 1, "a bundled change pushes no second time")

	// Losing the right hides the entry.
	f.setAccess(t, booked, `{}`)
	assert.Empty(t, f.entries(t, booked.AccountID), "after the right is withdrawn the entry is gone")
}

func TestMenuChangeFollowsWindowAndSchoolSwitch(t *testing.T) {
	t.Parallel()
	f := newMenuChangeFixture(t)
	family := f.family(t, true)
	f.consent(family.AccountID)

	// Past days tell nobody.
	f.setMenu(t, "2030-06-07", "Fisch")
	f.setMenu(t, "2030-06-07", "Gemüse")
	assert.Empty(t, f.entries(t, family.AccountID), "a day already over tells nobody")

	// More than 14 days ahead: the feed entry only, no push.
	f.setMenu(t, "2030-06-26", "Fisch")
	f.setMenu(t, "2030-06-26", "Gemüse")
	entries := f.entries(t, family.AccountID)
	require.Len(t, entries, 1)
	assert.Equal(t, fmt.Sprintf("/meal-plan?week=2030-06-24&school=%d", f.tenantID), entries[0].DeepLink)
	assert.Empty(t, f.pushes(t, family.AccountID), "a change more than 14 days ahead reaches the feed only")

	// Who changes the menu hears nothing about it, also as a guardian with
	// a booking.
	for _, dish := range []string{"Fisch", "Gemüse"} {
		req := httptest.NewRequest(http.MethodPut, "/2030-06-19", strings.NewReader(fmt.Sprintf(`{"dishes":[{"dish":%q}]}`, dish)))
		req.Header.Set("Content-Type", "application/json")
		f.mealRequestAs(t, req, family.AccountID)
	}
	assert.Len(t, f.entries(t, family.AccountID), 1, "the person who changed the menu gets nothing")

	// A school that sets the switch to its default keeps the notice.
	require.NoError(t, f.settings.SetValue(testpkg.Ctx(t), "notifications.meal_plan_changed_enabled", true, nil, nil))
	f.setMenu(t, "2030-06-18", "Fisch")
	f.setMenu(t, "2030-06-18", "Gemüse")
	assert.Len(t, f.entries(t, family.AccountID), 2, "an explicit default keeps the notice")
	require.Len(t, f.pushes(t, family.AccountID), 1, "and its push within 14 days")

	// The school switch stops feed entry and push.
	require.NoError(t, f.settings.SetValue(testpkg.Ctx(t), "notifications.meal_plan_changed_enabled", false, nil, nil))
	f.setMenu(t, "2030-06-12", "Fisch")
	f.setMenu(t, "2030-06-12", "Gemüse")
	assert.Len(t, f.entries(t, family.AccountID), 2, "a school that switched it off writes no entry")
	assert.Len(t, f.pushes(t, family.AccountID), 1, "and no push")
}

func TestMenuChangeWritesFeedOutsidePushWindow(t *testing.T) {
	t.Parallel()
	f := newMenuChangeFixture(t)
	family := f.family(t, true)
	f.consent(family.AccountID)

	// Closing the window suppresses the push, but this notice is not held for
	// a later retry: changing the menu must still commit its feed entry.
	f.setMenu(t, "2030-06-12", "Fisch")
	testpkg.SetTestTenantSetting(t, f.db, f.tenantID, "notifications.active_window_start", `""`)
	f.setMenu(t, "2030-06-12", "Gemüse")

	entries := f.entries(t, family.AccountID)
	require.Len(t, entries, 1)
	assert.Equal(t, menuChangeType, entries[0].Type)
	assert.Empty(t, f.pushes(t, family.AccountID), "outside the window the entry is feed-only")
}
