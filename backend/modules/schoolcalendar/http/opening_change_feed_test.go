package staffcalendarhttp_test

// Die geänderte Öffnungszeit im Benachrichtigungs-Feed (#8178), von außen
// geprüft: die Leitung trägt sie über ihre Route ein, Delivery schreibt Feed
// und Push-Outbox in derselben Transaktion, und jedes Konto liest seinen
// eigenen Feed über die Routen seines Portals.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	apiTest "github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// openingFeedToday pins the calendar's day: the push window counts from it.
const openingFeedToday = "2030-06-10"

type openingFeedFixture struct {
	db       *bun.DB
	school   int64
	changes  chi.Router
	feed     chi.Router
	versions map[string]string
	// notifications reach Delivery as the serving root binds them.
	notifications owners.DeliveryNotifications
}

func newOpeningFeedFixture(t *testing.T, school int64) *openingFeedFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	unit := testpkg.TenantRuntime(t, db)
	module, err := rootAPI.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := rootAPI.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	audience, ok := notifier.(deliveryContract.SchoolAudience)
	require.True(t, ok)
	traeger, ok := notifier.(deliveryContract.TraegerFeedNotifier)
	require.True(t, ok)
	notifications := owners.DeliveryNotifications{
		Notifier: notifier, Preferences: module.NotificationPreferences, SchoolAudience: audience, TraegerNotices: traeger,
	}
	changes := rootAPI.NewOpeningChangesWithNotices(notifications, func() string { return openingFeedToday })
	// Equal bounds open the push window all day.
	testpkg.SetTestTenantSetting(t, db, school, "notifications.dispatch_enabled", `true`)
	testpkg.SetTestTenantSetting(t, db, school, "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, school, "notifications.active_window_end", `"06:00"`)
	inner := chi.NewRouter()
	inner.Mount("/opening-changes", calendarAPI.NewOpeningChangeResource(changes).Router(rootAPI.ProtectedTenantRoutes))
	return &openingFeedFixture{
		db: db, school: school, changes: testpkg.MountedQueryBudgetRouter("/api", inner),
		feed: module.NotificationPreferenceRouterForTests(), versions: map[string]string{}, notifications: notifications,
	}
}

func (f *openingFeedFixture) staff(t *testing.T, name string, withActivities bool) int64 {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, f.school, name, "Öffnungszeit")
	if withActivities {
		testpkg.GrantTestPermission(t, f.db, f.school, account.ID, "activities:read")
	}
	f.device(t, account.ID, "staff")
	return account.ID
}

func (f *openingFeedFixture) device(t *testing.T, accountID int64, portal string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, ?, ?, 'test-p256dh', 'test-auth')`, f.school, accountID, portal, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/opening-%s-%d", portal, accountID))
	require.NoError(t, err)
}

// save creates (id ""), updates or deletes (day "") an opening change
// through the Leitung's route and answers its id.
func (f *openingFeedFixture) save(t *testing.T, actor int64, method, id, from, until, closes, reason string) string {
	t.Helper()
	path, want, right := openingChangesPath, http.StatusCreated, permissions.SchedulesCreate
	if id != "" {
		path, want, right = openingChangesPath+id, http.StatusOK, permissions.SchedulesUpdate
	}
	var payload bytes.Buffer
	if method == http.MethodDelete {
		right = permissions.SchedulesDelete
	} else {
		require.NoError(t, json.NewEncoder(&payload).Encode(map[string]any{
			"start_date": from, "end_date": until, "opens_at": "07:30", "closes_at": closes, "reason": reason, "expected_version": f.versions[id],
		}))
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	rec := apiTest.ExecuteWithAuth(t, f.changes, request, apiTest.TenantUserTestClaims(int(actor), f.school, right))
	require.Equal(t, want, rec.Code, rec.Body.String())
	if method == http.MethodDelete {
		return id
	}
	change := decodeOpeningChangeData[openingChangeBody](t, rec)
	f.versions[change.ID] = change.Version
	return change.ID
}

type openingFeedEntry struct {
	ID         testpkg.ID `json:"id"`
	Type       string     `json:"type"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	DeepLink   string     `json:"deep_link"`
	SchoolName string     `json:"school_name"`
}

// entries reads the feed of the account in the staff portal ("staff"), in
// moto schule ("school"), in the parents portal ("parent") or in the bell of
// the Träger-Portal ("traeger", tenantID is then the Träger).
func (f *openingFeedFixture) entries(t *testing.T, accountID, tenantID int64, scope string) []openingFeedEntry {
	t.Helper()
	path := "/api/notifications/feed"
	claims := apiTest.TeacherTestClaims(int(accountID))
	claims.TenantID = tenantID
	switch scope {
	case "school":
		claims.Scope, path = "school", "/school/notifications/feed"
	case "parent":
		claims, path = apiTest.ParentTestClaims(int(accountID)), "/parent/me/notifications/feed"
	case "traeger":
		roles := []string{identityaccess.TraegerRoleReadOnly}
		claims, path = testpkg.TraegerTestClaims(int(accountID), tenantID, roles, identityaccess.TraegerRights(roles)), "/traeger/notifications/feed/"
	}
	req := apiTest.NewAuthenticatedRequest(t, http.MethodGet, path, nil, apiTest.WithJWTBearer(apiTest.MintTestJWT(t, claims)))
	rec := apiTest.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var feed struct {
		Data struct {
			Entries []openingFeedEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &feed))
	return feed.Data.Entries
}

func (f *openingFeedFixture) markRead(t *testing.T, accountID, entryID int64) {
	t.Helper()
	claims := apiTest.TeacherTestClaims(int(accountID))
	claims.TenantID = f.school
	req := apiTest.NewAuthenticatedRequest(t, http.MethodPost, fmt.Sprintf("/api/notifications/feed/%d/read", entryID), nil, apiTest.WithJWTBearer(apiTest.MintTestJWT(t, claims)))
	rec := apiTest.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func (f *openingFeedFixture) pushes(t *testing.T, accountID int64) int {
	t.Helper()
	count, err := f.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", f.school).
		Where("(recipient->>'account_id')::bigint = ?", accountID).
		Where("payload->>'type' IN (?, ?)", deliveryContract.NotificationOpeningChangeChanged, deliveryContract.NotificationParentOpeningChangeChanged).
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

func revokePortalAccess(t *testing.T, db *bun.DB, chain testpkg.ParentChain) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, chain.GuardianProfileID)
	require.NoError(t, err)
}

func TestOpeningChangeFeedReachesStaffFamiliesAndTheTraegerOfTheSchoolOnly(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	foreign := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Fremder Träger", Slug: fmt.Sprintf("opening-feed-foreign-%d", testpkg.UniqueTestTenantID(t)), Active: true,
	}).ID
	// The test's school belongs to its Träger; the families of the fixtures
	// are children of that school.
	school := testpkg.Tenant(t)
	var own int64
	var schoolName string
	require.NoError(t, db.QueryRowContext(context.Background(), `SELECT organization_id, name FROM platform.schools WHERE id = ?`, school).Scan(&own, &schoolName))
	f := newOpeningFeedFixture(t, school)
	leitung, staff, quiet := f.staff(t, "Leitung", true), f.staff(t, "Betreuung", true), f.staff(t, "Ruhig", true)
	withoutActivities := f.staff(t, "Ohne Recht", false)
	teacher := testpkg.CreateTestAccount(t, db, "opening-teacher")
	testpkg.AssignLehrkraftSystemRole(t, db, teacher.ID, school)
	f.device(t, teacher.ID, "school")
	family, withoutAccess := testpkg.CreateTestParentGuardianChain(t, db), testpkg.CreateTestParentGuardianChain(t, db)
	f.device(t, family.AccountID, "parent")
	revokePortalAccess(t, db, withoutAccess)
	office, stranger := testpkg.CreateTestAccount(t, db, "opening-office"), testpkg.CreateTestAccount(t, db, "opening-stranger")
	testpkg.CreateTestTraegerMember(t, db, own, office.ID, identityaccess.TraegerRoleReadOnly)
	testpkg.CreateTestTraegerMember(t, db, own, leitung, identityaccess.TraegerRoleAdministration)
	testpkg.CreateTestTraegerMember(t, db, foreign, stranger.ID, identityaccess.TraegerRoleReadOnly)
	consent := rootAPI.NewNotificationConsentTestStore(testpkg.NewDatabase(t, db))
	require.NoError(t, testpkg.TenantCommand3(t, testpkg.Ctx(t), db, consent.RecordConsent, quiet, deliveryContract.NotificationOpeningChangeChanged, false))

	f.save(t, leitung, http.MethodPost, "", "2030-06-12", "2030-06-12", "12:00", "Weihnachtsfeier")

	const body = "Am 12.06.2030 ist von 07:30 bis 12:00 Uhr geöffnet: Weihnachtsfeier."
	for _, person := range []int64{staff, quiet} {
		entries := f.entries(t, person, school, "staff")
		require.Len(t, entries, 1)
		assert.Equal(t, deliveryContract.NotificationOpeningChangeChanged, entries[0].Type)
		assert.Equal(t, "Geänderte Öffnungszeit", entries[0].Title)
		assert.Equal(t, body, entries[0].Body)
		assert.Equal(t, "/calendar", entries[0].DeepLink)
	}
	parent := f.entries(t, family.AccountID, 0, "parent")
	require.Len(t, parent, 1, "the family reads it in the parents portal")
	assert.Equal(t, deliveryContract.NotificationParentOpeningChangeChanged, parent[0].Type)
	assert.Equal(t, body, parent[0].Body)
	assert.Equal(t, "/parents/calendar?date=2030-06-12", parent[0].DeepLink)
	bell := f.entries(t, office.ID, own, "traeger")
	require.Len(t, bell, 1, "the Träger-Büro reads it in its bell")
	assert.Equal(t, deliveryContract.NotificationTraegerOpeningChangeChanged, bell[0].Type)
	assert.Equal(t, body, bell[0].Body)
	assert.Equal(t, fmt.Sprintf("/traeger/schulen/%d", school), bell[0].DeepLink)
	assert.Equal(t, schoolName, bell[0].SchoolName)

	assert.Empty(t, f.entries(t, leitung, school, "staff"), "who entered it gets nothing")
	assert.Empty(t, f.entries(t, leitung, own, "traeger"), "not even in the Träger's bell")
	assert.Empty(t, f.entries(t, withoutActivities, school, "staff"), "an OGS account without activities:read gets nothing")
	assert.Empty(t, f.entries(t, teacher.ID, school, "school"), "moto schule stays out (#8172)")
	assert.Empty(t, f.entries(t, withoutAccess.AccountID, 0, "parent"), "a guardian without portal access gets nothing")
	assert.Empty(t, f.entries(t, stranger.ID, foreign, "traeger"), "another Träger gets nothing")
	assert.Empty(t, f.entries(t, office.ID, foreign, "traeger"), "a session of another Träger shows nothing of this school")

	assert.Equal(t, 1, f.pushes(t, staff))
	assert.Equal(t, 1, f.pushes(t, family.AccountID))
	assert.Zero(t, f.pushes(t, quiet), "who switched it off gets the entry without a push")
	assert.Zero(t, f.pushes(t, leitung))
	assert.Zero(t, f.pushes(t, teacher.ID))

	// The family's access is checked on every read.
	revokePortalAccess(t, db, family)
	assert.Empty(t, f.entries(t, family.AccountID, 0, "parent"), "a family that lost the access reads nothing")

	// Another school sees nothing, not even a person who belongs to both.
	other := testpkg.NewTenantScope(t, db)
	testpkg.MapAccountToTenant(t, db, staff, other.TenantID)
	assert.Empty(t, f.entries(t, staff, other.TenantID, "staff"))
}

func TestOpeningChangeFeedFollowsTheWindowAndTheSchoolSwitch(t *testing.T) {
	t.Parallel()
	f := newOpeningFeedFixture(t, testpkg.Tenant(t))
	leitung, staff := f.staff(t, "Leitung", true), f.staff(t, "Betreuung", true)
	family := testpkg.CreateTestParentGuardianChain(t, f.db)
	f.device(t, family.AccountID, "parent")
	var traeger int64
	require.NoError(t, f.db.QueryRowContext(context.Background(), `SELECT organization_id FROM platform.schools WHERE id = ?`, f.school).Scan(&traeger))
	office := testpkg.CreateTestAccount(t, f.db, "opening-window-office")
	testpkg.CreateTestTraegerMember(t, f.db, traeger, office.ID, identityaccess.TraegerRoleReadOnly)

	// Only past days: nobody hears about it.
	f.save(t, leitung, http.MethodPost, "", "2030-06-03", "2030-06-07", "12:00", "Vorbei")
	assert.Empty(t, f.entries(t, staff, f.school, "staff"))

	// More than 14 days ahead: a feed entry without a push.
	far := f.save(t, leitung, http.MethodPost, "", "2030-06-25", "2030-06-26", "12:00", "Sommerfest")
	entries := f.entries(t, staff, f.school, "staff")
	require.Len(t, entries, 1)
	assert.Equal(t, "Vom 25.06.2030 bis 26.06.2030 ist von 07:30 bis 12:00 Uhr geöffnet: Sommerfest.", entries[0].Body)
	assert.Zero(t, f.pushes(t, staff))

	// A new name on the same days and times tells nobody again.
	f.save(t, leitung, http.MethodPut, far, "2030-06-25", "2030-06-26", "12:00", "Fest")
	require.Len(t, f.entries(t, staff, f.school, "staff"), 1)
	assert.Equal(t, entries[0].Body, f.entries(t, staff, f.school, "staff")[0].Body)

	// Another closing time while the entry is unread: the entry is updated.
	f.save(t, leitung, http.MethodPut, far, "2030-06-25", "2030-06-26", "13:00", "Fest")
	entries = f.entries(t, staff, f.school, "staff")
	require.Len(t, entries, 1)
	assert.Equal(t, "Öffnungszeit geändert", entries[0].Title)
	assert.Equal(t, "Die geänderte Öffnungszeit „Fest“ gilt jetzt vom 25.06.2030 bis 26.06.2030 von 07:30 bis 13:00 Uhr. Bisher: vom 25.06.2030 bis 26.06.2030 von 07:30 bis 12:00 Uhr.", entries[0].Body)

	// Read, then deleted: a new entry.
	f.markRead(t, staff, int64(entries[0].ID))
	f.save(t, leitung, http.MethodDelete, far, "", "", "", "")
	entries = f.entries(t, staff, f.school, "staff")
	require.Len(t, entries, 2)
	assert.Equal(t, "Geänderte Öffnungszeit entfällt", entries[0].Title)
	assert.Equal(t, "Die geänderte Öffnungszeit „Fest“ vom 25.06.2030 bis 26.06.2030 entfällt. Es gelten wieder die normalen Öffnungszeiten.", entries[0].Body)

	// The 14th day ahead still lies in the window: a push to staff and family.
	assert.Zero(t, f.pushes(t, family.AccountID))
	f.save(t, leitung, http.MethodPost, "", "2030-06-24", "2030-06-24", "12:00", "Brückentag")
	assert.Len(t, f.entries(t, staff, f.school, "staff"), 3)
	assert.Equal(t, 1, f.pushes(t, staff))
	assert.Equal(t, 1, f.pushes(t, family.AccountID))

	// A family that switched the push off still gets the entry.
	consent := rootAPI.NewNotificationConsentTestStore(testpkg.NewDatabase(t, f.db))
	require.NoError(t, testpkg.TenantCommand3(t, testpkg.Ctx(t), f.db, consent.RecordConsent, family.AccountID, deliveryContract.NotificationParentOpeningChangeChanged, false))
	parentBefore := len(f.entries(t, family.AccountID, 0, "parent"))
	f.save(t, leitung, http.MethodPost, "", "2030-06-12", "2030-06-12", "12:00", "Elternabend")
	assert.Len(t, f.entries(t, family.AccountID, 0, "parent"), parentBefore+1)
	assert.Equal(t, 1, f.pushes(t, family.AccountID), "the family switched the push off")
	assert.Equal(t, 2, f.pushes(t, staff))

	// A school that switched the type off gets neither entry nor push, for
	// staff, families and the Träger-Büro alike.
	parentBefore, bellBefore := len(f.entries(t, family.AccountID, 0, "parent")), len(f.entries(t, office.ID, traeger, "traeger"))
	require.Positive(t, bellBefore)
	testpkg.SetTestTenantSetting(t, f.db, f.school, "notifications.opening_change_enabled", "false")
	f.save(t, leitung, http.MethodPost, "", "2030-06-13", "2030-06-13", "12:00", "Studientag")
	assert.Len(t, f.entries(t, staff, f.school, "staff"), 4)
	assert.Len(t, f.entries(t, family.AccountID, 0, "parent"), parentBefore)
	assert.Len(t, f.entries(t, office.ID, traeger, "traeger"), bellBefore)
	assert.Equal(t, 2, f.pushes(t, staff))
}
