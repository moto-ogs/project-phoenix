//go:build testhooks

package notifications_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/notifications"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The existing staff types write the notification feed as well (#7137).
// The catalogue says which: every staff type except the message types,
// whose inboxes count unread messages themselves, and the reminders, which
// the bell lists in their own section. School and parent portal types wait
// for their bells (#7139, #7140).
func TestFeedTypesAreTheStaffNoticesBesideMessagesAndReminders(t *testing.T) {
	t.Parallel()
	var feed []string
	for _, def := range notifications.TypesForPortal(notifications.PortalStaff) {
		if def.Feed {
			feed = append(feed, def.Key)
		}
	}
	assert.ElementsMatch(t, []string{
		notifications.TypeStudentPickupChanged,
		notifications.TypeStudentAbsenceReported,
		notifications.TypeStaffStudentNoteShared,
		notifications.TypeStaffSurvey,
		notifications.TypeStaffPlannedExit,
		notifications.TypeStaffQualificationExpiry,
		notifications.TypeStaffQualificationOwnExpiry,
		notifications.TypeStaffNoticePublished,
		notifications.TypeInstanceCancelled,
		notifications.TypeInstanceRoomChanged,
		notifications.TypeInstanceRoomChangedLater,
		notifications.TypeStaffingChanged,
		notifications.TypeGroupStaffingChanged,
		notifications.TypeTeamMemberAbsent,
	}, feed)
	for _, key := range []string{notifications.TypeStaffParentMessage, notifications.TypeStaffMessage, notifications.TypeParentMessage} {
		def, ok := notifications.GetType(key)
		require.True(t, ok)
		assert.False(t, def.Feed, "%s has an inbox of its own", key)
	}

	// The usage analytics keep the type of a clicked entry only for the
	// types the frontend lists; a feed type missing there loses it.
	helpers, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "..", "frontend", "src", "lib", "notification-feed-helpers.ts"))
	require.NoError(t, err)
	for _, key := range feed {
		assert.Contains(t, string(helpers), `"`+key+`",`, "NOTIFICATION_FEED_ANALYTICS_TYPES lacks %s", key)
	}
}

type feedTypesWorld struct {
	db       *bun.DB
	tenantID int64
	notifier deliveryCompose.Notifier
	router   chi.Router
}

func newFeedTypesWorld(t *testing.T) *feedTypesWorld {
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
	w := &feedTypesWorld{db: db, tenantID: testpkg.Tenant(t), notifier: notifier, router: module.NotificationPreferenceRouterForTests()}
	w.setting(t, "notifications.dispatch_enabled", "true")
	// Equal bounds open the push window all day.
	w.setting(t, "notifications.active_window_start", `"06:00"`)
	w.setting(t, "notifications.active_window_end", `"06:00"`)
	for _, def := range notifications.TypesForPortal(notifications.PortalStaff) {
		if def.Feed && def.TenantGate != "" {
			w.setting(t, def.TenantGate, "true")
		}
	}
	return w
}

func (w *feedTypesWorld) setting(t *testing.T, key, jsonValue string) {
	t.Helper()
	testpkg.SetTestTenantSetting(t, w.db, w.tenantID, key, jsonValue)
}

// person is a staff member of the school with one staff-portal device.
func (w *feedTypesWorld) person(t *testing.T, name string) int64 {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccount(t, w.db, name, "Feedtyp")
	testpkg.MapAccountToTenant(t, w.db, account.ID, w.tenantID)
	testpkg.AssignLehrkraftSystemRole(t, w.db, account.ID, w.tenantID)
	_, err := w.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'staff', ?, 'test-p256dh', 'test-auth')`, w.tenantID, account.ID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/feedtype-%d", account.ID))
	require.NoError(t, err)
	return account.ID
}

// event is a notice of the type to both accounts that may push to push.
func (w *feedTypesWorld) event(notificationType string, objectID int64, accounts []int64, feed *contract.NotificationFeedDelivery) notifications.Event {
	return notifications.Event{
		Type: notificationType, IdempotencyKey: fmt.Sprintf("feedtype:%s:%d", notificationType, objectID),
		RelatedType: "feedtype_object", RelatedID: objectID,
		Title: "Hinweis", Body: "Etwas hat sich geändert.", DeepLink: "/start",
		Audience: notifications.Audience{TenantID: w.tenantID, Scope: notifications.ScopeStaff, StaffAccountIDs: accounts},
		Feed:     feed,
	}
}

func (w *feedTypesWorld) notify(t *testing.T, event notifications.Event) error {
	t.Helper()
	return testpkg.WithinTenantContext(t, context.Background(), w.db, w.tenantID, func(ctx context.Context) error {
		return w.notifier.Notify(ctx, event)
	})
}

// feed lists the types of the account's feed entries, read through the
// staff portal's route.
func (w *feedTypesWorld) feed(t *testing.T, accountID int64) []string {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = w.tenantID
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/api/notifications/feed", nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	response := testutil.ExecuteRequestForTest(t, w.router, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var page struct {
		Data struct {
			Entries []struct {
				Type string `json:"type"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
	types := make([]string, 0, len(page.Data.Entries))
	for _, entry := range page.Data.Entries {
		types = append(types, entry.Type)
	}
	return types
}

// pushes counts the push intents of the type for the account.
func (w *feedTypesWorld) pushes(t *testing.T, accountID int64, notificationType string) int {
	t.Helper()
	count, err := w.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", w.tenantID).
		Where("(recipient->>'account_id')::bigint = ?", accountID).
		Where("payload->>'type' = ?", notificationType).
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

// One table over the catalogue instead of a router test per type (#7137):
// every feed type reaches the feed of its whole audience and pushes only to
// the producer's push recipients; a school that switched the type off gets
// neither.
func TestEveryFeedTypeWritesTheFeedAndPushesByChoice(t *testing.T) {
	t.Parallel()
	w := newFeedTypesWorld(t)
	pushed, quiet, outside := w.person(t, "Push"), w.person(t, "Leise"), w.person(t, "Fremd")

	var gated []notifications.TypeDefinition
	for i, def := range notifications.TypesForPortal(notifications.PortalStaff) {
		if !def.Feed {
			continue
		}
		require.NoError(t, w.notify(t, w.event(def.Key, int64(1000+i), []int64{pushed, quiet},
			&contract.NotificationFeedDelivery{PushAccountIDs: []int64{pushed}})), def.Key)
		assert.Equal(t, 1, w.pushes(t, pushed, def.Key), "%s pushes to whom the producer allows", def.Key)
		assert.Zero(t, w.pushes(t, quiet, def.Key), "%s: the own switch blocks the push only", def.Key)
		if def.TenantGate != "" {
			gated = append(gated, def)
		}
	}
	feedTypes := 0
	for _, def := range notifications.TypesForPortal(notifications.PortalStaff) {
		if def.Feed {
			feedTypes++
			assert.Contains(t, w.feed(t, pushed), def.Key)
			assert.Contains(t, w.feed(t, quiet), def.Key)
		}
	}
	assert.Len(t, w.feed(t, pushed), feedTypes)
	assert.Empty(t, w.feed(t, outside), "who is not in the audience gets nothing")

	// A school that switched a type off gets neither feed entry nor push.
	require.NotEmpty(t, gated)
	for i, def := range gated {
		w.setting(t, def.TenantGate, "false")
		require.NoError(t, w.notify(t, w.event(def.Key, int64(2000+i), []int64{outside}, &contract.NotificationFeedDelivery{PushAccountIDs: []int64{outside}})))
		assert.Zero(t, w.pushes(t, outside, def.Key), def.Key)
	}
	assert.Empty(t, w.feed(t, outside))
}

// A type and its delivery path belong together: a feed type is refused
// without its feed recipients and outside Notify, a message type is refused
// with them. Nothing reaches the feed by a side door.
func TestFeedDeliveryIsBoundToTheType(t *testing.T) {
	t.Parallel()
	w := newFeedTypesWorld(t)
	person := w.person(t, "Pfad")
	feed := &contract.NotificationFeedDelivery{PushAccountIDs: []int64{person}}

	require.Error(t, w.notify(t, w.event(notifications.TypeStudentPickupChanged, 1, []int64{person}, nil)),
		"a feed type without its feed recipients would push past the feed")
	require.Error(t, w.notify(t, w.event(notifications.TypeStaffMessage, 2, []int64{person}, feed)),
		"a message type stays out of the bell")
	err := testpkg.WithinTenantContext(t, context.Background(), w.db, w.tenantID, func(ctx context.Context) error {
		return w.notifier.NotifyBatch(ctx, []notifications.Event{w.event(notifications.TypeStaffSurvey, 3, []int64{person}, nil)})
	})
	require.Error(t, err, "only Notify writes the feed")
	assert.Empty(t, w.feed(t, person))
	assert.Zero(t, w.pushes(t, person, notifications.TypeStudentPickupChanged))
}

// Outside the school's notification window a feed entry is written without
// a push; a producer that repeats its notice holds both back instead.
func TestFeedOutsideTheWindow(t *testing.T) {
	t.Parallel()
	w := newFeedTypesWorld(t)
	person := w.person(t, "Fenster")
	// A blank bound closes the window.
	w.setting(t, "notifications.active_window_start", `""`)

	require.NoError(t, w.notify(t, w.event(notifications.TypeStaffStudentNoteShared, 1, []int64{person},
		&contract.NotificationFeedDelivery{PushAccountIDs: []int64{person}})))
	assert.Equal(t, []string{notifications.TypeStaffStudentNoteShared}, w.feed(t, person))
	assert.Zero(t, w.pushes(t, person, notifications.TypeStaffStudentNoteShared))

	err := w.notify(t, w.event(notifications.TypeStaffPlannedExit, 2, []int64{person},
		&contract.NotificationFeedDelivery{PushAccountIDs: []int64{person}, HoldOutsideWindow: true}))
	require.ErrorIs(t, err, notifications.ErrOutsideActiveWindow)
	assert.Equal(t, []string{notifications.TypeStaffStudentNoteShared}, w.feed(t, person), "the held notice comes on its repeat")
}

// A push that opens the app without a link still gives its feed entry one.
func TestFeedEntryTakesTheFeedLink(t *testing.T) {
	t.Parallel()
	w := newFeedTypesWorld(t)
	person := w.person(t, "Link")
	event := w.event(notifications.TypeStudentAbsenceReported, 1, []int64{person},
		&contract.NotificationFeedDelivery{PushAccountIDs: []int64{person}, DeepLink: "/students"})
	event.DeepLink = ""
	require.NoError(t, w.notify(t, event))

	var link string
	require.NoError(t, w.db.NewRaw(`SELECT deep_link FROM platform.notification_feed_entries WHERE tenant_id = ? AND account_id = ?`,
		w.tenantID, person).Scan(context.Background(), &link))
	assert.Equal(t, "/students", link)
}
