package httpintegration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	fixtures "github.com/moto-ogs/project-phoenix/modules/timetable/fixturetest"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The notification feed of a cancellation (#7148) is tested from the outside:
// a block is cancelled through the real lifecycle, Delivery writes the feed
// and the push outbox in that transaction, and each account reads its own
// feed through the staff portal's routes.

// feedNow pins the lifecycle's clock: the relevance window counts from it.
var feedNow = time.Date(2030, 6, 10, 10, 0, 0, 0, calendar.Berlin)

type feedFixture struct {
	s         *lifecycleSetup
	svc       fixtures.InstanceLifecycle
	reinstate timetable.InstanceReinstatement
	notices   timetablePorts.StaffCancellationNotices
	router    chi.Router
	consentDB func(accountID int64, enabled bool)
	// typedConsent stores an account's push choice for a notification type.
	typedConsent func(accountID int64, notificationType string, enabled bool)
}

type feedPerson struct {
	staffID   int64
	accountID int64
}

func newFeedFixture(t *testing.T) *feedFixture {
	t.Helper()
	s := buildLifecycle(t, func() time.Time { return feedNow })
	database := testpkg.NewDatabase(t, s.db)
	unit := testpkg.TenantRuntime(t, s.db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	notices := owners.NewTimetableStaffCancellationNotices(owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences})
	require.NotNil(t, notices)
	// Equal bounds open the push window all day, so the test does not depend
	// on the wall clock it runs at.
	testpkg.SetTestTenantSetting(t, s.db, testpkg.Tenant(t), "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, s.db, testpkg.Tenant(t), "notifications.active_window_end", `"06:00"`)
	deps := lifecycleDependencies(s, nil)
	deps.StaffNotices = notices
	deps.Now = func() time.Time { return feedNow }
	consent := api.NewNotificationConsentTestStore(database)
	lifecycle, err := compose.NewInstanceLifecycle(deps)
	require.NoError(t, err)
	return &feedFixture{
		s: s, svc: fixtures.FromInstanceLifecycle(lifecycle), reinstate: lifecycle, notices: notices, router: module.NotificationPreferenceRouterForTests(),
		consentDB: func(accountID int64, enabled bool) {
			require.NoError(t, testpkg.TenantCommand3(t, s.ctx, s.db, consent.RecordConsent, accountID, "instance_cancelled", enabled))
		},
		typedConsent: func(accountID int64, notificationType string, enabled bool) {
			require.NoError(t, testpkg.TenantCommand3(t, s.ctx, s.db, consent.RecordConsent, accountID, notificationType, enabled))
		},
	}
}

// person is a staff member with an account in the school and one staff-portal
// device.
func (f *feedFixture) person(t *testing.T, name string) feedPerson {
	t.Helper()
	staff, account := testpkg.CreateTestStaffWithAccount(t, f.s.db, name, "Feed")
	testpkg.MapAccountToTenant(t, f.s.db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, f.s.db, account.ID, testpkg.Tenant(t))
	_, err := f.s.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'staff', ?, 'test-p256dh', 'test-auth')`, testpkg.Tenant(t), account.ID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/feed-%d", account.ID))
	require.NoError(t, err)
	return feedPerson{staffID: staff.ID, accountID: account.ID}
}

// block is a planned block on date staffed by the given people.
func (f *feedFixture) block(t *testing.T, date calendar.Date, staff ...feedPerson) int64 {
	t.Helper()
	instance := testpkg.CreateTestActivityInstance(t, f.s.db, date, f.s.roomID, testpkg.ActivityInstanceOpts{Title: "Fußball-AG"})
	for _, person := range staff {
		testpkg.CreateTestInstanceStaff(t, f.s.db, instance.ID, person.staffID, testpkg.InstanceStaffOpts{})
	}
	return instance.ID
}

type feedResponse struct {
	Data struct {
		Entries []struct {
			ID       testpkg.ID `json:"id"`
			Type     string     `json:"type"`
			Title    string     `json:"title"`
			Body     string     `json:"body"`
			DeepLink string     `json:"deep_link"`
			ReadAt   *string    `json:"read_at"`
		} `json:"entries"`
		NextCursor  *string `json:"next_cursor"`
		UnreadCount int     `json:"unread_count"`
	} `json:"data"`
}

func (f *feedFixture) call(t *testing.T, accountID, tenantID int64, method, path string) (int, []byte) {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = tenantID
	request := testutil.NewAuthenticatedRequest(t, method, path, nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	response := testutil.ExecuteRequestForTest(t, f.router, request)
	return response.Code, response.Body.Bytes()
}

func (f *feedFixture) feed(t *testing.T, person feedPerson, query string) feedResponse {
	t.Helper()
	code, body := f.call(t, person.accountID, testpkg.Tenant(t), http.MethodGet, "/api/notifications/feed"+query)
	require.Equal(t, http.StatusOK, code, string(body))
	var feed feedResponse
	require.NoError(t, json.Unmarshal(body, &feed))
	return feed
}

// pushes counts the cancellation push intents for the account.
func (f *feedFixture) pushes(t *testing.T, person feedPerson) int {
	t.Helper()
	return f.pushesOf(t, person, "instance_cancelled")
}

// pushesOf counts the push intents of the type for the account.
func (f *feedFixture) pushesOf(t *testing.T, person feedPerson, notificationType string) int {
	t.Helper()
	count, err := f.s.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", testpkg.Tenant(t)).
		Where("(recipient->>'account_id')::bigint = ?", person.accountID).
		Where("payload->>'type' = ?", notificationType).
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

func (f *feedFixture) cancel(t *testing.T, instanceID int64, actor feedPerson) {
	t.Helper()
	_, err := f.svc.Cancel(f.s.ctx, instanceID, nil, &actor.accountID)
	require.NoError(t, err)
}

func TestCancellationFeedReachesThePlannedStaffOnly(t *testing.T) {
	t.Parallel()
	f := newFeedFixture(t)
	actor, planned, quiet, unrelated := f.person(t, "Actor"), f.person(t, "Planned"), f.person(t, "Quiet"), f.person(t, "Unrelated")
	f.consentDB(quiet.accountID, false)
	instanceID := f.block(t, calendar.NewDate(2030, 6, 11), actor, planned, quiet)

	f.cancel(t, instanceID, actor)

	for _, person := range []feedPerson{planned, quiet} {
		feed := f.feed(t, person, "")
		require.Len(t, feed.Data.Entries, 1)
		entry := feed.Data.Entries[0]
		assert.Equal(t, "instance_cancelled", entry.Type)
		assert.Equal(t, "Termin abgesagt", entry.Title)
		assert.Equal(t, "„Fußball-AG“ am Di. 11.06. um "+entryStart(t, f, instanceID)+" Uhr fällt aus.", entry.Body)
		assert.Equal(t, "/mein-dienstplan?d=2030-06-11", entry.DeepLink)
		assert.Nil(t, entry.ReadAt)
		assert.Equal(t, 1, feed.Data.UnreadCount)
	}
	assert.Empty(t, f.feed(t, actor, "").Data.Entries, "the person who cancelled gets nothing")
	assert.Empty(t, f.feed(t, unrelated, "").Data.Entries, "who was not planned gets nothing")
	assert.Equal(t, 1, f.pushes(t, planned))
	assert.Zero(t, f.pushes(t, quiet), "the own switch blocks the push, not the feed entry")
	assert.Zero(t, f.pushes(t, actor))

	// Another school of the same person sees nothing of this school.
	foreign := testpkg.NewTenantScope(t, f.s.db)
	testpkg.MapAccountToTenant(t, f.s.db, planned.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.s.db, planned.accountID, foreign.TenantID)
	code, body := f.call(t, planned.accountID, foreign.TenantID, http.MethodGet, "/api/notifications/feed")
	require.Equal(t, http.StatusOK, code, string(body))
	var other feedResponse
	require.NoError(t, json.Unmarshal(body, &other))
	assert.Empty(t, other.Data.Entries)

	// Who left the school keeps no view of its entries.
	_, err := f.s.db.ExecContext(context.Background(), `UPDATE auth.account_tenants SET status = 'inactive' WHERE account_id = ? AND tenant_id = ?`, quiet.accountID, testpkg.Tenant(t))
	require.NoError(t, err)
	assert.Empty(t, f.feed(t, quiet, "").Data.Entries)
}

func entryStart(t *testing.T, f *feedFixture, instanceID int64) string {
	t.Helper()
	var start time.Time
	require.NoError(t, f.s.db.NewRaw(`SELECT start_time FROM schedule.activity_instances WHERE id = ?`, instanceID).Scan(context.Background(), &start))
	return start.Format("15:04")
}

func TestCancellationFeedFollowsTheRelevanceWindowAndTheSchoolSwitch(t *testing.T) {
	t.Parallel()
	f := newFeedFixture(t)
	actor, planned := f.person(t, "Actor"), f.person(t, "Planned")

	// More than 14 days ahead: a feed entry without a push.
	f.cancel(t, f.block(t, calendar.NewDate(2030, 6, 25), actor, planned), actor)
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 1)
	assert.Zero(t, f.pushes(t, planned))

	// 14 days ahead is still within the window.
	f.cancel(t, f.block(t, calendar.NewDate(2030, 6, 24), actor, planned), actor)
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 2)
	assert.Equal(t, 1, f.pushes(t, planned))

	// A past block tells nobody.
	f.cancel(t, f.block(t, calendar.NewDate(2030, 6, 9), actor, planned), actor)
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 2)

	// A school that switched the type off gets neither entry nor push.
	testpkg.SetTestTenantSetting(t, f.s.db, testpkg.Tenant(t), "notifications.instance_cancelled_enabled", "false")
	f.cancel(t, f.block(t, calendar.NewDate(2030, 6, 12), actor, planned), actor)
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 2)
	assert.Equal(t, 1, f.pushes(t, planned))
}

func TestCancellationFeedBundlesAndReads(t *testing.T) {
	t.Parallel()
	f := newFeedFixture(t)
	actor, planned := f.person(t, "Actor"), f.person(t, "Planned")
	first := f.block(t, calendar.NewDate(2030, 6, 11), actor, planned)
	f.cancel(t, first, actor)
	second := f.block(t, calendar.NewDate(2030, 6, 12), actor, planned)
	f.cancel(t, second, actor)

	// A second change of the same object while the entry is unread updates
	// it and moves it to the top, without a second push.
	notice := timetablePorts.StaffCancellationNotice{InstanceID: first, Title: "Schach-AG", Date: calendar.NewDate(2030, 6, 11), AccountIDs: []int64{planned.accountID}, Push: true}
	require.NoError(t, testpkg.WithinTenantTransaction(f.s.ctx, f.s.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		return f.notices.NotifyInstanceCancelled(txCtx, notice)
	}))
	feed := f.feed(t, planned, "")
	require.Len(t, feed.Data.Entries, 2)
	assert.Equal(t, "„Schach-AG“ am Di. 11.06. fällt aus.", feed.Data.Entries[0].Body)
	assert.Equal(t, 2, f.pushes(t, planned), "one push per new entry")

	// Pages: one entry per page, then the cursor.
	page := f.feed(t, planned, "?limit=1")
	require.Len(t, page.Data.Entries, 1)
	require.NotNil(t, page.Data.NextCursor)
	next := f.feed(t, planned, "?limit=1&cursor="+*page.Data.NextCursor)
	require.Len(t, next.Data.Entries, 1)
	assert.NotEqual(t, page.Data.Entries[0].ID, next.Data.Entries[0].ID)
	assert.Nil(t, next.Data.NextCursor)
	code, body := f.call(t, planned.accountID, testpkg.Tenant(t), http.MethodGet, "/api/notifications/feed?cursor=not-a-cursor")
	assert.Equal(t, http.StatusBadRequest, code, "a cursor the feed did not issue: %s", body)

	// Reading one entry, a foreign entry and all entries.
	bundled := feed.Data.Entries[0].ID
	code, body = f.call(t, actor.accountID, testpkg.Tenant(t), http.MethodPost, fmt.Sprintf("/api/notifications/feed/%d/read", bundled))
	assert.Equal(t, http.StatusNotFound, code, "an entry of another account stays unread: %s", body)
	code, body = f.call(t, planned.accountID, testpkg.Tenant(t), http.MethodPost, fmt.Sprintf("/api/notifications/feed/%d/read", bundled))
	require.Equal(t, http.StatusOK, code, string(body))
	assert.JSONEq(t, `{"unread_count":1}`, string(dataOf(t, body)))

	// A change after the entry was read is a new entry.
	require.NoError(t, testpkg.WithinTenantTransaction(f.s.ctx, f.s.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		return f.notices.NotifyInstanceCancelled(txCtx, notice)
	}))
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 3)
	assert.Equal(t, 3, f.pushes(t, planned))

	code, body = f.call(t, planned.accountID, testpkg.Tenant(t), http.MethodPost, "/api/notifications/feed/read-all")
	require.Equal(t, http.StatusOK, code, string(body))
	assert.JSONEq(t, `{"unread_count":0}`, string(dataOf(t, body)))
	code, body = f.call(t, planned.accountID, testpkg.Tenant(t), http.MethodGet, "/api/notifications/feed/unread-count")
	require.Equal(t, http.StatusOK, code, string(body))
	assert.JSONEq(t, `{"unread_count":0}`, string(dataOf(t, body)))
}

func dataOf(t *testing.T, body []byte) json.RawMessage {
	t.Helper()
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &envelope))
	return envelope.Data
}

// schoolCall is call with a session of moto schule (#7139).
func (f *feedFixture) schoolCall(t *testing.T, accountID int64, method, path string) (int, []byte) {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = testpkg.Tenant(t)
	claims.Scope = "school"
	request := testutil.NewAuthenticatedRequest(t, method, path, nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	response := testutil.ExecuteRequestForTest(t, f.router, request)
	return response.Code, response.Body.Bytes()
}

func (f *feedFixture) schoolFeed(t *testing.T, person feedPerson) feedResponse {
	t.Helper()
	code, body := f.schoolCall(t, person.accountID, http.MethodGet, "/school/notifications/feed")
	require.Equal(t, http.StatusOK, code, string(body))
	var feed feedResponse
	require.NoError(t, json.Unmarshal(body, &feed))
	return feed
}

// TestCancellationFeedReachesMotoSchule reads the cancellation (#7139) in a
// session of moto schule: the same entry of the account with the school's
// link, a push to the account's school device, the read state shared with
// the staff portal, and only for accounts that may use moto schule. A type
// the school portal does not offer stays out of its feed.
func TestCancellationFeedReachesMotoSchule(t *testing.T) {
	t.Parallel()
	f := newFeedFixture(t)
	actor, teacher := f.person(t, "Actor"), f.person(t, "Teacher")
	_, err := f.s.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'school', ?, 'test-p256dh', 'test-auth')`, testpkg.Tenant(t), teacher.accountID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/feed-school-%d", teacher.accountID))
	require.NoError(t, err)
	// A staff member without a school-portal role.
	staffOnly := func() feedPerson {
		staff, account := testpkg.CreateTestStaffWithAccount(t, f.s.db, "StaffOnly", "Feed")
		testpkg.MapAccountToTenant(t, f.s.db, account.ID, testpkg.Tenant(t))
		role := testpkg.CreateTestRoleForTenant(t, f.s.db, "betreuung", testpkg.Tenant(t))
		_, err := f.s.db.ExecContext(context.Background(), `INSERT INTO auth.account_roles (account_id, role_id, tenant_id) VALUES (?, ?, ?)`, account.ID, role.ID, testpkg.Tenant(t))
		require.NoError(t, err)
		return feedPerson{staffID: staff.ID, accountID: account.ID}
	}()
	instanceID := f.block(t, calendar.NewDate(2030, 6, 11), actor, teacher, staffOnly)

	f.cancel(t, instanceID, actor)

	feed := f.schoolFeed(t, teacher)
	require.Len(t, feed.Data.Entries, 1)
	entry := feed.Data.Entries[0]
	assert.Equal(t, "instance_cancelled", entry.Type)
	assert.Equal(t, "Termin abgesagt", entry.Title)
	assert.Equal(t, "/school/aufsichten", entry.DeepLink, "the link of moto schule, not the staff portal's")
	assert.Equal(t, 1, feed.Data.UnreadCount)
	schoolPushes, err := f.s.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", testpkg.Tenant(t)).
		Where("(recipient->>'account_id')::bigint = ?", teacher.accountID).
		Where("recipient->>'portal' = 'school'").
		Where("payload->>'type' = 'instance_cancelled'").
		Count(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, int(schoolPushes), "the school device gets the push")
	assert.Empty(t, f.schoolFeed(t, actor).Data.Entries, "the person who cancelled gets nothing")
	assert.Empty(t, f.schoolFeed(t, staffOnly).Data.Entries, "without a school-portal role moto schule shows nothing")
	assert.Len(t, f.feed(t, staffOnly, "").Data.Entries, 1, "the staff portal shows the entry")

	// A type the school portal does not offer stays in the staff portal.
	_, err = f.s.db.ExecContext(context.Background(), `INSERT INTO platform.notification_feed_entries
		(tenant_id, account_id, type, title, body, deep_link, related_type, related_id)
		VALUES (?, ?, 'pickup_upcoming', 'Abholung', 'Bald.', '/dashboard', 'student', 1)`, testpkg.Tenant(t), teacher.accountID)
	require.NoError(t, err)
	assert.Len(t, f.schoolFeed(t, teacher).Data.Entries, 1)
	assert.Len(t, f.feed(t, teacher, "").Data.Entries, 2)

	// Read in moto schule is read in the staff portal; "all read" in moto
	// schule leaves the staff-only entry unread.
	code, body := f.schoolCall(t, teacher.accountID, http.MethodPost, fmt.Sprintf("/school/notifications/feed/%d/read", entry.ID))
	require.Equal(t, http.StatusOK, code, string(body))
	assert.JSONEq(t, `{"unread_count":0}`, string(dataOf(t, body)))
	assert.Equal(t, 1, f.feed(t, teacher, "").Data.UnreadCount)
	code, body = f.schoolCall(t, teacher.accountID, http.MethodPost, "/school/notifications/feed/read-all")
	require.Equal(t, http.StatusOK, code, string(body))
	assert.Equal(t, 1, f.feed(t, teacher, "").Data.UnreadCount)
	code, body = f.schoolCall(t, teacher.accountID, http.MethodGet, "/school/notifications/feed/unread-count")
	require.Equal(t, http.StatusOK, code, string(body))
	assert.JSONEq(t, `{"unread_count":0}`, string(dataOf(t, body)))
	var staffEntryID int64
	for _, candidate := range f.feed(t, teacher, "").Data.Entries {
		if candidate.Type == "pickup_upcoming" {
			staffEntryID = int64(candidate.ID)
		}
	}
	require.NotZero(t, staffEntryID)
	code, body = f.schoolCall(t, teacher.accountID, http.MethodPost, fmt.Sprintf("/school/notifications/feed/%d/read", staffEntryID))
	assert.Equal(t, http.StatusNotFound, code, "moto schule cannot read an entry it does not show: %s", body)
}
