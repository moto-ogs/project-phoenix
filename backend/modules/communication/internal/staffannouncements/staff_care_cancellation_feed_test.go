package announcement_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	announcement "github.com/moto-ogs/project-phoenix/modules/communication/internal/application"
	records "github.com/moto-ogs/project-phoenix/modules/communication/internal/staffannouncements"
	configModel "github.com/moto-ogs/project-phoenix/modules/settings"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/roots/communicationtest"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The bell of the parents portal (#7140) is tested from the outside: the
// cancellation notice is published through the real announcement service and
// the real notification router, which writes the feed and the push outbox in
// the publishing transaction, and each guardian reads the feed through the
// parents portal's routes.

type guardianFeedFixture struct {
	db     *bun.DB
	svc    announcement.StaffService
	router chi.Router
}

func newGuardianFeedFixture(t *testing.T) *guardianFeedFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	unit := testpkg.TenantRuntime(t, db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), configModel.KeyNotificationsDispatchEnabled, `true`)
	// Equal bounds open the push window all day, so the test does not depend
	// on the wall clock it runs at.
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "notifications.active_window_end", `"06:00"`)
	reposMessages := api.NewParentMessagingSuiteRepositories(database)
	svc := announcement.NewService(announcement.ServiceConfig{
		Repo:        records.NewRepository(reposMessages.ParentAnnouncement),
		Settings:    configModel.NewParentAnnouncementValues(noticeSettings()),
		Notifier:    noticeNotificationCallback(owners.BindCommunicationNotificationSender(notifier)),
		Preferences: module.NotificationPreferences,
		ParentsURL:  "https://parents.example.test",
	}, testpkg.TenantTransactionRuntime{}, deliveryPolicy.NewParentDeliveryPolicy())
	return &guardianFeedFixture{db: db, svc: svc, router: module.NotificationPreferenceRouterForTests()}
}

// family is a guardian with portal access to one child, a parents-portal
// device and the cancellation push switched on.
func (f *guardianFeedFixture) family(t *testing.T) testpkg.ParentChain {
	t.Helper()
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'parent', ?, 'test-p256dh', 'test-auth')`, chain.TenantID, chain.AccountID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/parent-feed-%d", chain.AccountID))
	require.NoError(t, err)
	consent := api.NewNotificationConsentTestStore(testpkg.NewDatabase(t, f.db))
	require.NoError(t, testpkg.TenantCommand3(t, testpkg.Ctx(t), f.db, consent.RecordConsent, chain.AccountID, announcement.TypeParentCareCancelled, true))
	return chain
}

func (f *guardianFeedFixture) cancel(t *testing.T, actor int64, studentIDs ...int64) {
	t.Helper()
	ctx := testpkg.Ctx(t)
	require.NoError(t, tenant.WithTenantTx(testpkg.WithTenantRuntime(t, ctx, f.db), f.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		_, err := testpkg.TenantQuery1(t, txCtx, f.db, f.svc.PublishCareCancellation, announcement.CareCancellationInput{
			StudentIDs: studentIDs,
			Title:      "Fußball-AG am Dienstag entfällt",
			Body:       "Die Fußball-AG am Dienstag von 14:00 bis 15:30 fällt aus.",
			CreatedBy:  actor,
		})
		return err
	}))
}

type guardianFeedResponse struct {
	Data struct {
		Entries []struct {
			ID       int64   `json:"id"`
			Type     string  `json:"type"`
			Title    string  `json:"title"`
			Body     string  `json:"body"`
			DeepLink string  `json:"deep_link"`
			ReadAt   *string `json:"read_at"`
		} `json:"entries"`
		UnreadCount int `json:"unread_count"`
	} `json:"data"`
}

func (f *guardianFeedFixture) call(t *testing.T, accountID int64, method, path string) (int, []byte) {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, method, path, nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, testutil.ParentTestClaims(int(accountID)))))
	response := testutil.ExecuteRequestForTest(t, f.router, request)
	return response.Code, response.Body.Bytes()
}

func (f *guardianFeedFixture) feed(t *testing.T, accountID int64) guardianFeedResponse {
	t.Helper()
	code, body := f.call(t, accountID, http.MethodGet, "/parent/me/notifications/feed")
	require.Equal(t, http.StatusOK, code, string(body))
	var feed guardianFeedResponse
	require.NoError(t, json.Unmarshal(body, &feed))
	return feed
}

// pushes returns the title and body of the cancellation pushes of the account.
func (f *guardianFeedFixture) pushes(t *testing.T, accountID int64) []string {
	t.Helper()
	var texts []string
	require.NoError(t, f.db.NewRaw(`SELECT concat_ws(' | ', payload->>'title', payload->>'body') FROM platform.push_outbox
		WHERE tenant_id = ? AND (recipient->>'account_id')::bigint = ? AND payload->>'type' = ?`,
		testpkg.Tenant(t), accountID, announcement.TypeParentCareCancelled).Scan(context.Background(), &texts))
	return texts
}

func (f *guardianFeedFixture) setAccess(t *testing.T, chain testpkg.ParentChain, permissions string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = ?::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`,
		permissions, chain.GuardianProfileID)
	require.NoError(t, err)
}

func TestCareCancellationReachesTheGuardianFeedWithRelationshipAccess(t *testing.T) {
	t.Parallel()
	f := newGuardianFeedFixture(t)
	parent, membershipOnly := f.family(t), f.family(t)
	original := `{"parent_portal.access": true}`
	f.setAccess(t, membershipOnly, `{}`)
	actor := testpkg.CreateTestAccount(t, f.db, "cancel-actor")

	f.cancel(t, actor.ID, parent.StudentID, membershipOnly.StudentID)

	feed := f.feed(t, parent.AccountID)
	require.Len(t, feed.Data.Entries, 1)
	entry := feed.Data.Entries[0]
	assert.Equal(t, announcement.TypeParentCareCancelled, entry.Type)
	assert.Equal(t, "Fußball-AG am Dienstag entfällt", entry.Title, "the entry carries what the person cancelling wrote")
	assert.Equal(t, "Die Fußball-AG am Dienstag von 14:00 bis 15:30 fällt aus.", entry.Body)
	assert.Equal(t, "/news", entry.DeepLink, "the entry leads to the one existing notice")
	assert.Nil(t, entry.ReadAt)
	assert.Equal(t, 1, feed.Data.UnreadCount)
	assert.Empty(t, f.feed(t, membershipOnly.AccountID).Data.Entries, "membership without parent_portal.access sees nothing")

	// One push for the one notice, display-safe on the lock screen.
	pushes := f.pushes(t, parent.AccountID)
	require.Len(t, pushes, 1, "the notice is pushed once, not a second time for the feed")
	for _, leak := range []string{"Felix", "Schneider", "Fußball", "14:00"} {
		assert.NotContains(t, pushes[0], leak, "no child data or notice text on the lock screen")
	}
	assert.Empty(t, f.pushes(t, membershipOnly.AccountID))

	// A guardian never reads the entry in the staff portal, even as staff
	// of the same school.
	testpkg.AssignLehrkraftSystemRole(t, f.db, parent.AccountID, parent.TenantID)
	claims := testutil.TeacherTestClaims(int(parent.AccountID))
	claims.TenantID = parent.TenantID
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/api/notifications/feed", nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	response := testutil.ExecuteRequestForTest(t, f.router, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.NotContains(t, response.Body.String(), "Fußball-AG", "the staff feed shows no entry of a guardian")

	// Losing the right hides the entry; nothing is deleted, so it is back
	// when the school grants the right again.
	f.setAccess(t, parent, `{}`)
	revoked := f.feed(t, parent.AccountID)
	assert.Empty(t, revoked.Data.Entries)
	assert.Zero(t, revoked.Data.UnreadCount)
	code, body := f.call(t, parent.AccountID, http.MethodPost, fmt.Sprintf("/parent/me/notifications/feed/%d/read", entry.ID))
	assert.Equal(t, http.StatusNotFound, code, string(body))
	f.setAccess(t, parent, original)
	require.Len(t, f.feed(t, parent.AccountID).Data.Entries, 1)

	// Who left the school keeps no view of its entries, also while a
	// guardian of another school.
	foreign := testpkg.NewTenantScope(t, f.db)
	testpkg.MapAccountToTenant(t, f.db, parent.AccountID, foreign.TenantID)
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO auth.account_roles (account_id, role_id, tenant_id)
		SELECT ?, id, ? FROM auth.roles WHERE name = 'guardian'`, parent.AccountID, foreign.TenantID)
	require.NoError(t, err)
	_, err = f.db.ExecContext(context.Background(), `UPDATE auth.account_tenants SET status = 'inactive' WHERE account_id = ? AND tenant_id = ?`, parent.AccountID, parent.TenantID)
	require.NoError(t, err)
	assert.Empty(t, f.feed(t, parent.AccountID).Data.Entries, "another school of the family sees nothing of this one")
}

func TestGuardianFeedMarksReadByClickOrAll(t *testing.T) {
	t.Parallel()
	f := newGuardianFeedFixture(t)
	parent := f.family(t)
	actor := testpkg.CreateTestAccount(t, f.db, "cancel-actor")
	f.cancel(t, actor.ID, parent.StudentID)
	f.cancel(t, actor.ID, parent.StudentID)

	feed := f.feed(t, parent.AccountID)
	require.Len(t, feed.Data.Entries, 2, "every cancellation is a notice of its own")
	assert.Equal(t, 2, feed.Data.UnreadCount)

	code, body := f.call(t, parent.AccountID, http.MethodPost, fmt.Sprintf("/parent/me/notifications/feed/%d/read", feed.Data.Entries[0].ID))
	require.Equal(t, http.StatusOK, code, string(body))
	assert.True(t, strings.Contains(string(body), `"unread_count":1`), string(body))

	other := f.family(t)
	code, body = f.call(t, other.AccountID, http.MethodPost, fmt.Sprintf("/parent/me/notifications/feed/%d/read", feed.Data.Entries[1].ID))
	assert.Equal(t, http.StatusNotFound, code, "another family cannot touch the entry: %s", body)

	code, body = f.call(t, parent.AccountID, http.MethodPost, "/parent/me/notifications/feed/read-all")
	require.Equal(t, http.StatusOK, code, string(body))
	after := f.feed(t, parent.AccountID)
	assert.Zero(t, after.Data.UnreadCount)
	for _, entry := range after.Data.Entries {
		assert.NotNil(t, entry.ReadAt)
	}
}
