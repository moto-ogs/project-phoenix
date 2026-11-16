package timetablehttp_test

// Der Hinweis der Leitung im Benachrichtigungs-Feed (#7143), von außen
// geprüft: die Leitung legt den Hinweis über ihre Route an, Delivery schreibt
// Feed und Push-Outbox in derselben Transaktion, und jedes Konto liest seinen
// eigenen Feed über die Routen des Staff-Portals.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	"github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	timetablehttp "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// noticeFeedToday pins the service's day: the relevance window counts from it.
var noticeFeedToday = calendar.NewDate(2030, 6, 10)

type noticeFeedFixture struct {
	db       *bun.DB
	tenantID int64
	notices  chi.Router
	feed     chi.Router
	consent  func(accountID int64, enabled bool)
}

type noticeFeedPerson struct {
	accountID int64
	email     string
}

func newNoticeFeedFixture(t *testing.T) *noticeFeedFixture {
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
	members := owners.MustNewMembershipTestRepositories(testpkg.NewDatabase(t, db))
	publications := owners.NewTimetableStaffNoticePublications(members.Staff, owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences})
	require.NotNil(t, publications)
	// Equal bounds open the push window all day, so the test does not depend
	// on the wall clock it runs at.
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, tenantID, "notifications.active_window_end", `"06:00"`)
	service := compose.NewStaffNotices(compose.StaffNoticeDependencies{
		DB: db, Publications: publications, Logger: slog.Default(),
		CurrentDate: func() calendar.Date { return noticeFeedToday },
	})
	consent := api.NewNotificationConsentTestStore(database)
	return &noticeFeedFixture{
		db: db, tenantID: tenantID,
		notices: timetablehttp.NewStaffNoticeResource(service, noticeAccountID).Router(api.ProtectedTenantRoutes),
		feed:    module.NotificationPreferenceRouterForTests(),
		consent: func(accountID int64, enabled bool) {
			ctx := testpkg.Ctx(t)
			require.NoError(t, testpkg.TenantCommand3(t, ctx, db, consent.RecordConsent, accountID, "staff_notice_published", enabled))
		},
	}
}

// reader is a staff member of the school who reads the Tagesinformationen
// (users:read) and has one staff-portal device.
func (f *noticeFeedFixture) reader(t *testing.T, name string) noticeFeedPerson {
	t.Helper()
	person := f.member(t, name)
	testpkg.GrantTestPermission(t, f.db, f.tenantID, person.accountID, "users:read")
	return person
}

func (f *noticeFeedFixture) member(t *testing.T, name string) noticeFeedPerson {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, f.tenantID, name, "Hinweis")
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'staff', ?, 'test-p256dh', 'test-auth')`, f.tenantID, account.ID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/notice-%d", account.ID))
	require.NoError(t, err)
	return noticeFeedPerson{accountID: account.ID, email: account.Email}
}

// save creates (id 0) or updates a notice through the Leitung's route.
func (f *noticeFeedFixture) save(t *testing.T, author noticeFeedPerson, id int64, body string) int64 {
	t.Helper()
	method, path, want := http.MethodPost, "/", http.StatusCreated
	if id != 0 {
		method, path, want = http.MethodPut, fmt.Sprintf("/%d", id), http.StatusOK
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := f.noticeRequest(t, req, author, []string{"admin:*"})
	require.Equal(t, want, rec.Code, rec.Body.String())
	var envelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	saved, err := strconv.ParseInt(envelope.Data.ID, 10, 64)
	require.NoError(t, err)
	return saved
}

func (f *noticeFeedFixture) noticeRequest(t *testing.T, req *http.Request, who noticeFeedPerson, permissions []string) *httptest.ResponseRecorder {
	t.Helper()
	claims := routetest.DefaultTestClaims()
	claims.ID = int(who.accountID)
	claims.Sub = who.email
	claims.Username = who.email
	claims.Roles = []string{"user"}
	claims.IsAdmin = false
	claims.TenantID = f.tenantID
	return routetest.ExecuteWithAuthPermissions(t, testpkg.MountedQueryBudgetRouter("/api/staff-notices", f.notices), req, claims, permissions)
}

type noticeFeedEntry struct {
	Type     string  `json:"type"`
	Title    string  `json:"title"`
	Body     string  `json:"body"`
	DeepLink string  `json:"deep_link"`
	ReadAt   *string `json:"read_at"`
}

func (f *noticeFeedFixture) entries(t *testing.T, who noticeFeedPerson, tenantID int64) []noticeFeedEntry {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(who.accountID))
	claims.TenantID = tenantID
	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/api/notifications/feed", nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	rec := testutil.ExecuteRequestForTest(t, f.feed, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var feed struct {
		Data struct {
			Entries []noticeFeedEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &feed))
	return feed.Data.Entries
}

// pushes counts the push intents of the type for the account.
func (f *noticeFeedFixture) pushes(t *testing.T, who noticeFeedPerson) int {
	t.Helper()
	count, err := f.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", f.tenantID).
		Where("(recipient->>'account_id')::bigint = ?", who.accountID).
		Where("payload->>'type' = 'staff_notice_published'").
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

func noticeBody(title, audience, from, until string, active bool) string {
	untilField := ""
	if until != "" {
		untilField = fmt.Sprintf(`,"valid_until":%q`, until)
	}
	return fmt.Sprintf(`{"title":%q,"audience":%q,"valid_from":%q%s,"weekdays":[],"active":%t}`, title, audience, from, untilField, active)
}

func TestStaffNoticeFeedReachesTheAudienceOnly(t *testing.T) {
	t.Parallel()
	f := newNoticeFeedFixture(t)
	author, reader, pushed := f.reader(t, "Leitung"), f.reader(t, "Betreuung"), f.reader(t, "Handy")
	teacher := f.member(t, "Lehrkraft")
	testpkg.AssignLehrkraftSystemRole(t, f.db, teacher.accountID, f.tenantID)
	f.consent(pushed.accountID, true)

	id := f.save(t, author, 0, noticeBody("Turnhalle belegt", "all", "2030-06-11", "2030-06-14", true))

	for _, person := range []noticeFeedPerson{reader, pushed} {
		entries := f.entries(t, person, f.tenantID)
		require.Len(t, entries, 1)
		assert.Equal(t, "staff_notice_published", entries[0].Type)
		assert.Equal(t, "Neuer Hinweis der Leitung", entries[0].Title)
		assert.Equal(t, "„Turnhalle belegt“ gilt vom 11.06.2030 bis 14.06.2030.", entries[0].Body)
		assert.Equal(t, fmt.Sprintf("/tagesinformationen?hinweis=%d", id), entries[0].DeepLink)
		assert.Nil(t, entries[0].ReadAt)
	}
	assert.Empty(t, f.entries(t, author, f.tenantID), "who published it gets nothing")
	assert.Empty(t, f.entries(t, teacher, f.tenantID), "who does not read the Tagesinformationen gets nothing")
	assert.Zero(t, f.pushes(t, reader), "the push is off by default, the feed entry comes")
	assert.Equal(t, 1, f.pushes(t, pushed), "who switched the push on gets it")
	assert.Zero(t, f.pushes(t, author))

	// The link leads to the Hinweis, even before it applies.
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/%d", id), nil)
	rec := f.noticeRequest(t, req, reader, []string{"users:read"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"title":"Turnhalle belegt"`)

	// A Hinweis only for the Lehrkräfte of moto schule reaches nobody in the
	// OGS portal, and its link finds nothing there.
	forTeachers := f.save(t, author, 0, noticeBody("Übergabe später", "lehrkraft", "2030-06-11", "", true))
	assert.Len(t, f.entries(t, reader, f.tenantID), 1)
	rec = f.noticeRequest(t, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/%d", forTeachers), nil), reader, []string{"users:read"})
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())

	// Another school of the same person sees nothing of this school.
	foreign := testpkg.NewTenantScope(t, f.db)
	testpkg.MapAccountToTenant(t, f.db, reader.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.db, reader.accountID, foreign.TenantID)
	assert.Empty(t, f.entries(t, reader, foreign.TenantID))
}

func TestStaffNoticeFeedFollowsTheWindowTheSwitchAndActivation(t *testing.T) {
	t.Parallel()
	f := newNoticeFeedFixture(t)
	author, pushed := f.reader(t, "Leitung"), f.reader(t, "Handy")
	f.consent(pushed.accountID, true)

	// More than 14 days ahead: a feed entry without a push.
	f.save(t, author, 0, noticeBody("Sommerfest", "staff", "2030-06-25", "", true))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 1)
	assert.Zero(t, f.pushes(t, pushed))

	// 14 days ahead is still within the window; a running Hinweis too.
	f.save(t, author, 0, noticeBody("Elternabend", "all", "2030-06-24", "", true))
	f.save(t, author, 0, noticeBody("Baustelle", "all", "2030-06-01", "", true))
	entries := f.entries(t, pushed, f.tenantID)
	require.Len(t, entries, 3)
	assert.Equal(t, "„Baustelle“ gilt ab 01.06.2030.", entries[0].Body)
	assert.Equal(t, 2, f.pushes(t, pushed))

	// A Hinweis that has already ended tells nobody.
	f.save(t, author, 0, noticeBody("Vorbei", "all", "2030-06-01", "2030-06-09", true))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 3)

	// A Hinweis saved switched off tells nobody until it is switched on;
	// an edit of a Hinweis that is on tells nobody again.
	draft := f.save(t, author, 0, noticeBody("Entwurf", "all", "2030-06-12", "", false))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 3)
	f.save(t, author, draft, noticeBody("Entwurf", "all", "2030-06-12", "", true))
	entries = f.entries(t, pushed, f.tenantID)
	require.Len(t, entries, 4)
	assert.Equal(t, "„Entwurf“ gilt ab 12.06.2030.", entries[0].Body)
	f.save(t, author, draft, noticeBody("Entwurf geändert", "all", "2030-06-12", "", true))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 4)
	assert.Equal(t, 3, f.pushes(t, pushed))

	// Who switches a Hinweis on is the one who triggered it.
	f.save(t, pushed, draft, noticeBody("Entwurf geändert", "all", "2030-06-12", "", false))
	f.save(t, pushed, draft, noticeBody("Entwurf geändert", "all", "2030-06-12", "", true))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 4)
	assert.Len(t, f.entries(t, author, f.tenantID), 1)

	// Switched off and on again within the bundle window while the entry is
	// unread: the entry is updated and moves up, without a second push.
	f.save(t, author, draft, noticeBody("Entwurf geändert", "all", "2030-06-12", "", false))
	f.save(t, author, draft, noticeBody("Entwurf neu", "all", "2030-06-12", "", true))
	entries = f.entries(t, pushed, f.tenantID)
	require.Len(t, entries, 4)
	assert.Equal(t, "„Entwurf neu“ gilt ab 12.06.2030.", entries[0].Body)
	assert.Equal(t, 3, f.pushes(t, pushed), "a bundled update rings no phone again")

	// A Hinweis that only the Lehrkräfte saw reaches the Betreuung once its
	// audience includes them.
	widened := f.save(t, author, 0, noticeBody("Übergabe", "lehrkraft", "2030-06-12", "", true))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 4)
	f.save(t, author, widened, noticeBody("Übergabe", "all", "2030-06-12", "", true))
	entries = f.entries(t, pushed, f.tenantID)
	require.Len(t, entries, 5)
	assert.Equal(t, "„Übergabe“ gilt ab 12.06.2030.", entries[0].Body)

	// A school that switched the type off gets neither entry nor push.
	testpkg.SetTestTenantSetting(t, f.db, f.tenantID, "notifications.staff_notice_published_enabled", "false")
	f.save(t, author, 0, noticeBody("Ausflug", "all", "2030-06-12", "", true))
	assert.Len(t, f.entries(t, pushed, f.tenantID), 5)
	assert.Equal(t, 4, f.pushes(t, pushed))
}
