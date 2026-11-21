package timetablehttp_test

// Der Schließtag im Benachrichtigungs-Feed (#7144), von außen geprüft: die
// Leitung trägt den Schließtag über ihre Route ein, Delivery schreibt Feed und
// Push-Outbox in derselben Transaktion, und jedes Konto liest seinen eigenen
// Feed über die Routen seines Portals.

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
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	timetablehttp "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// closingFeedToday pins the calendar's day: the relevance window counts from it.
const closingFeedToday = "2030-06-10"

type closingFeedFixture struct {
	db       *bun.DB
	tenantID int64
	closing  chi.Router
	feed     chi.Router
	consent  func(accountID int64, notificationType string, enabled bool)
}

type closingFeedPerson struct {
	accountID int64
	email     string
}

func newClosingFeedFixture(t *testing.T) *closingFeedFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	return newClosingFeedFixtureIn(t, db, testpkg.Tenant(t))
}

// newClosingFeedFixtureIn is the fixture in the given school, such as one of
// a Träger (#7146).
func newClosingFeedFixtureIn(t *testing.T, db *bun.DB, tenantID int64) *closingFeedFixture {
	t.Helper()
	database := testpkg.NewDatabase(t, db)
	unit := testpkg.TenantRuntime(t, db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	audience, ok := notifier.(deliveryContract.SchoolAudience)
	require.True(t, ok)
	traeger, ok := notifier.(deliveryContract.TraegerFeedNotifier)
	require.True(t, ok)
	caterer, ok := notifier.(deliveryContract.CatererFeedNotifier)
	require.True(t, ok)
	calendar, err := api.NewSchoolCalendarWithClosingDayNotices(database, settings.Settings, owners.DeliveryNotifications{
		Notifier: notifier, Preferences: module.NotificationPreferences, SchoolAudience: audience, TraegerNotices: traeger, CatererNotices: caterer,
	}, closingFeedToday)
	require.NoError(t, err)
	// Equal bounds open the push window all day, so the test does not depend
	// on the wall clock it runs at.
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.dispatch_enabled", `true`)
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.active_window_end", `"06:00"`)
	resource := timetablehttp.NewResource(timetablehttp.Dependencies{ClosingDays: calendar, SettingsService: settings.Settings,
		// The resource runs on the calendar's pinned day.
		Now: func() time.Time { return time.Date(2030, time.June, 10, 10, 0, 0, 0, time.UTC) },
	})
	consent := api.NewNotificationConsentTestStore(database)
	return &closingFeedFixture{
		db: db, tenantID: tenantID,
		closing: resource.Router(api.ProtectedTenantRoutes),
		feed:    module.NotificationPreferenceRouterForTests(),
		consent: func(accountID int64, notificationType string, enabled bool) {
			require.NoError(t, testpkg.TenantCommand3(t, testpkg.Ctx(t), db, consent.RecordConsent, accountID, notificationType, enabled))
		},
	}
}

// staff is a member of the school with a staff role and a staff-portal device.
func (f *closingFeedFixture) staff(t *testing.T, name string) closingFeedPerson {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, f.tenantID, name, "Schließtag")
	testpkg.GrantTestPermission(t, f.db, f.tenantID, account.ID, "activities:read")
	f.device(t, account.ID, "staff")
	return closingFeedPerson{accountID: account.ID, email: account.Email}
}

// staffWithoutActivities is a member of the OGS portal but does not hold the
// permission the closing-day notification type requires there.
func (f *closingFeedFixture) staffWithoutActivities(t *testing.T, name string) closingFeedPerson {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, f.tenantID, name, "Schließtag")
	f.device(t, account.ID, "staff")
	return closingFeedPerson{accountID: account.ID, email: account.Email}
}

// teacher is a Lehrkraft of moto schule with a device there.
func (f *closingFeedFixture) teacher(t *testing.T) closingFeedPerson {
	t.Helper()
	account := testpkg.CreateTestAccount(t, f.db, "closing-teacher")
	testpkg.AssignLehrkraftSystemRole(t, f.db, account.ID, f.tenantID)
	f.device(t, account.ID, "school")
	return closingFeedPerson{accountID: account.ID, email: account.Email}
}

// family is a guardian with portal access to one child of the school and a
// parents-portal device.
func (f *closingFeedFixture) family(t *testing.T) testpkg.ParentChain {
	t.Helper()
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	f.device(t, chain.AccountID, "parent")
	return chain
}

func (f *closingFeedFixture) device(t *testing.T, accountID int64, portal string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, ?, ?, 'test-p256dh', 'test-auth')`, f.tenantID, accountID, portal, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/closing-%s-%d", portal, accountID))
	require.NoError(t, err)
}

// save creates (id 0), updates or deletes (body "") a closing day through
// the Leitung's route.
func (f *closingFeedFixture) save(t *testing.T, actor closingFeedPerson, method string, id int64, body string) int64 {
	t.Helper()
	path, want := "/closing-days/", http.StatusCreated
	if id != 0 {
		path, want = fmt.Sprintf("/closing-days/%d", id), http.StatusOK
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	claims := routetest.DefaultTestClaims()
	claims.ID, claims.Sub, claims.Username = int(actor.accountID), actor.email, actor.email
	claims.Roles, claims.IsAdmin, claims.TenantID = []string{"user"}, false, f.tenantID
	rec := routetest.ExecuteWithAuthPermissions(t, testpkg.MountedQueryBudgetRouter("/api/timetable", f.closing), req, claims,
		[]string{"schedules:create", "schedules:update", "schedules:delete"})
	require.Equal(t, want, rec.Code, rec.Body.String())
	if method == http.MethodDelete {
		return id
	}
	var envelope struct {
		Data timetablehttp.ClosingDayResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	return envelope.Data.ID
}

func closingDayBody(from, until, reason string) string {
	return fmt.Sprintf(`{"start_date":%q,"end_date":%q,"reason":%q}`, from, until, reason)
}

type closingFeedEntry struct {
	ID       testpkg.ID `json:"id"`
	Type     string     `json:"type"`
	Title    string     `json:"title"`
	Body     string     `json:"body"`
	DeepLink string     `json:"deep_link"`
	ReadAt   *string    `json:"read_at"`
}

// entries reads the feed of the account in the staff portal, in moto
// schule (scope "school") or in the parents portal (scope "parent").
func (f *closingFeedFixture) entries(t *testing.T, accountID, tenantID int64, scope string) []closingFeedEntry {
	t.Helper()
	path := "/api/notifications/feed"
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = tenantID
	switch scope {
	case "school":
		claims.Scope, path = "school", "/school/notifications/feed"
	case "parent":
		claims, path = testutil.ParentTestClaims(int(accountID)), "/parent/me/notifications/feed"
	}
	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	rec := testutil.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var feed struct {
		Data struct {
			Entries []closingFeedEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &feed))
	return feed.Data.Entries
}

func (f *closingFeedFixture) markRead(t *testing.T, accountID, entryID int64) {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = f.tenantID
	req := testutil.NewAuthenticatedRequest(t, http.MethodPost, fmt.Sprintf("/api/notifications/feed/%d/read", entryID), nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	rec := testutil.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

// pushes counts the closing-day push intents for the account.
func (f *closingFeedFixture) pushes(t *testing.T, accountID int64) int {
	t.Helper()
	count, err := f.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", f.tenantID).
		Where("(recipient->>'account_id')::bigint = ?", accountID).
		Where("payload->>'type' IN (?, ?)", deliveryContract.NotificationSchoolClosingDayChanged, deliveryContract.NotificationParentSchoolClosingDayChanged).
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

func TestClosingDayFeedReachesEveryAccountOfTheSchoolOnly(t *testing.T) {
	t.Parallel()
	f := newClosingFeedFixture(t)
	leitung, staff, quiet, departed := f.staff(t, "Leitung"), f.staff(t, "Betreuung"), f.staff(t, "Ruhig"), f.staff(t, "Ausgeschieden")
	withoutActivities := f.staffWithoutActivities(t, "Ohne Recht")
	testpkg.AssignLehrkraftSystemRole(t, f.db, withoutActivities.accountID, f.tenantID)
	f.device(t, withoutActivities.accountID, "school")
	teacher := f.teacher(t)
	family, withoutAccess := f.family(t), f.family(t)
	f.consent(quiet.accountID, deliveryContract.NotificationSchoolClosingDayChanged, false)
	_, err := f.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, withoutAccess.GuardianProfileID)
	require.NoError(t, err)
	_, err = f.db.ExecContext(context.Background(), `UPDATE auth.account_tenants SET status = 'inactive' WHERE account_id = ? AND tenant_id = ?`,
		departed.accountID, f.tenantID)
	require.NoError(t, err)

	f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-12", "2030-06-12", "Pädagogischer Tag"))

	const body = "Am 12.06.2030 ist ein Schließtag: Pädagogischer Tag."
	for _, person := range []closingFeedPerson{staff, quiet} {
		entries := f.entries(t, person.accountID, f.tenantID, "staff")
		require.Len(t, entries, 1)
		assert.Equal(t, deliveryContract.NotificationSchoolClosingDayChanged, entries[0].Type)
		assert.Equal(t, "Neuer Schließtag", entries[0].Title)
		assert.Equal(t, body, entries[0].Body)
		assert.Equal(t, "/calendar", entries[0].DeepLink)
	}
	school := f.entries(t, teacher.accountID, f.tenantID, "school")
	require.Len(t, school, 1, "the Lehrkraft reads it in moto schule")
	assert.Equal(t, "/school/kalender", school[0].DeepLink)
	schoolWithoutActivities := f.entries(t, withoutActivities.accountID, f.tenantID, "school")
	require.Len(t, schoolWithoutActivities, 1, "the account reads it only in moto schule")
	assert.Equal(t, "/school/kalender", schoolWithoutActivities[0].DeepLink)
	parent := f.entries(t, family.AccountID, 0, "parent")
	require.Len(t, parent, 1, "the family reads it in the parents portal")
	assert.Equal(t, deliveryContract.NotificationParentSchoolClosingDayChanged, parent[0].Type)
	assert.Equal(t, body, parent[0].Body)
	assert.Equal(t, "/parents/calendar?date=2030-06-12", parent[0].DeepLink)

	assert.Empty(t, f.entries(t, leitung.accountID, f.tenantID, "staff"), "who entered it gets nothing")
	assert.Empty(t, f.entries(t, departed.accountID, f.tenantID, "staff"), "who left the school gets nothing")
	assert.Empty(t, f.entries(t, withoutActivities.accountID, f.tenantID, "staff"), "an OGS account without activities:read gets nothing")
	assert.Empty(t, f.entries(t, withoutAccess.AccountID, 0, "parent"), "a guardian without portal access gets nothing")

	// The push is on until a person switches it off.
	assert.Equal(t, 1, f.pushes(t, staff.accountID))
	assert.Equal(t, 1, f.pushes(t, teacher.accountID))
	assert.Equal(t, 1, f.pushes(t, family.AccountID))
	assert.Zero(t, f.pushes(t, quiet.accountID), "who switched it off gets the entry without a push")
	assert.Zero(t, f.pushes(t, leitung.accountID))
	assert.Zero(t, f.pushes(t, departed.accountID))
	assert.Equal(t, 1, f.pushes(t, withoutActivities.accountID), "the school-only account gets the school push")

	// The family's access is checked on every read: once the school takes
	// parent_portal.access back, the entry is gone without being deleted.
	_, err = f.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, family.GuardianProfileID)
	require.NoError(t, err)
	assert.Empty(t, f.entries(t, family.AccountID, 0, "parent"), "a family that lost the access reads nothing")

	// Another school sees nothing, not even a person who belongs to both.
	foreign := testpkg.NewTenantScope(t, f.db)
	testpkg.MapAccountToTenant(t, f.db, staff.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.db, staff.accountID, foreign.TenantID)
	assert.Empty(t, f.entries(t, staff.accountID, foreign.TenantID, "staff"))
}

func TestClosingDayFeedFollowsTheWindowBundlingAndTheSchoolSwitch(t *testing.T) {
	t.Parallel()
	f := newClosingFeedFixture(t)
	leitung, staff := f.staff(t, "Leitung"), f.staff(t, "Betreuung")
	family := f.family(t)

	// Only past days: nobody hears about it.
	f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-03", "2030-06-07", "Vorbei"))
	assert.Empty(t, f.entries(t, staff.accountID, f.tenantID, "staff"))

	// More than 14 days ahead: a feed entry without a push.
	far := f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-25", "2030-06-26", "Betriebsausflug"))
	entries := f.entries(t, staff.accountID, f.tenantID, "staff")
	require.Len(t, entries, 1)
	assert.Equal(t, "Vom 25.06.2030 bis 26.06.2030 sind Schließtage: Betriebsausflug.", entries[0].Body)
	assert.Zero(t, f.pushes(t, staff.accountID))
	assert.Zero(t, f.pushes(t, family.AccountID))

	// A new reason on the same days tells nobody again.
	f.save(t, leitung, http.MethodPut, far, closingDayBody("2030-06-25", "2030-06-26", "Ausflug"))
	assert.Len(t, f.entries(t, staff.accountID, f.tenantID, "staff"), 1)

	// Moved into the window while the entry is unread: the entry is updated
	// and moves up, without a second entry; the push of the new entry is
	// left out, as for every bundled update.
	f.save(t, leitung, http.MethodPut, far, closingDayBody("2030-06-24", "2030-06-24", "Ausflug"))
	entries = f.entries(t, staff.accountID, f.tenantID, "staff")
	require.Len(t, entries, 1)
	assert.Equal(t, "Schließtag geändert", entries[0].Title)
	assert.Equal(t, "Der Schließtag „Ausflug“ ist jetzt am 24.06.2030. Bisher: vom 25.06.2030 bis 26.06.2030.", entries[0].Body)
	assert.Zero(t, f.pushes(t, staff.accountID))

	// Read, then cancelled: a new entry, and a push since the day lies
	// within 14 days.
	f.markRead(t, staff.accountID, int64(entries[0].ID))
	f.save(t, leitung, http.MethodDelete, far, "")
	entries = f.entries(t, staff.accountID, f.tenantID, "staff")
	require.Len(t, entries, 2)
	assert.Equal(t, "Schließtag entfällt", entries[0].Title)
	assert.Equal(t, "Der Schließtag „Ausflug“ am 24.06.2030 entfällt.", entries[0].Body)
	assert.Equal(t, 1, f.pushes(t, staff.accountID))
	parent := f.entries(t, family.AccountID, 0, "parent")
	require.Len(t, parent, 1, "the family's unread entry took the change and the cancellation")
	assert.Equal(t, "Schließtag entfällt", parent[0].Title)
	assert.Zero(t, f.pushes(t, family.AccountID), "a bundled update rings no phone")

	// A family that switched the push off still gets the entry.
	f.consent(family.AccountID, deliveryContract.NotificationParentSchoolClosingDayChanged, false)
	f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-11", "2030-06-11", "Brückentag"))
	assert.Len(t, f.entries(t, family.AccountID, 0, "parent"), 2)
	assert.Zero(t, f.pushes(t, family.AccountID), "the family switched the push off")
	assert.Equal(t, 2, f.pushes(t, staff.accountID))

	// A school that switched the type off gets neither entry nor push.
	testpkg.SetTestTenantSetting(t, f.db, f.tenantID, "notifications.school_closing_day_enabled", "false")
	f.save(t, leitung, http.MethodPost, 0, closingDayBody("2030-06-13", "2030-06-13", "Studientag"))
	assert.Len(t, f.entries(t, staff.accountID, f.tenantID, "staff"), 3)
	assert.Len(t, f.entries(t, family.AccountID, 0, "parent"), 2)
	assert.Equal(t, 2, f.pushes(t, staff.accountID))
}
