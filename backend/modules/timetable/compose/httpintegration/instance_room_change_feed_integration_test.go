package httpintegration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	fixtures "github.com/moto-ogs/project-phoenix/modules/timetable/fixturetest"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// A block that moves to another room (#7141) is tested from the outside:
// the room is changed through the real lifecycle edit, Delivery writes the
// feed and the push outbox in that transaction, and every account reads its
// own feed through the routes of its portal.

type roomFeedFixture struct {
	*feedFixture
	moveTo int64
	// rooms are the names of the fixture's two rooms.
	from, to string
}

func newRoomFeedFixture(t *testing.T) *roomFeedFixture {
	t.Helper()
	s := buildLifecycle(t)
	database := testpkg.NewDatabase(t, s.db)
	unit := testpkg.TenantRuntime(t, s.db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	notices := owners.NewTimetableStaffNotices(owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences}, nil, nil, nil).
		WithGuardianContacts(owners.MustNewPeopleDirectory(database))
	require.NotNil(t, notices.RoomChanges)
	testpkg.SetTestTenantSetting(t, s.db, testpkg.Tenant(t), "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, s.db, testpkg.Tenant(t), "notifications.active_window_end", `"06:00"`)
	deps := lifecycleDependencies(s, nil)
	deps.RoomNotices = notices.RoomChanges
	deps.Now = func() time.Time { return feedNow }
	lifecycle, err := compose.NewInstanceLifecycle(deps)
	require.NoError(t, err)
	consent := api.NewNotificationConsentTestStore(database)
	target := testpkg.CreateTestRoom(t, s.db, "Werkraum")
	f := &roomFeedFixture{
		feedFixture: &feedFixture{
			s: s, svc: fixtures.FromInstanceLifecycle(lifecycle), router: module.NotificationPreferenceRouterForTests(),
			typedConsent: func(accountID int64, notificationType string, enabled bool) {
				require.NoError(t, testpkg.TenantCommand3(t, s.ctx, s.db, consent.RecordConsent, accountID, notificationType, enabled))
			},
		},
		moveTo: target.ID, to: target.Name,
	}
	require.NoError(t, s.db.NewRaw(`SELECT name FROM facilities.rooms WHERE id = ?`, s.roomID).Scan(context.Background(), &f.from))
	return f
}

// family is a guardian with portal access to one child and a parents-portal
// device.
func (f *roomFeedFixture) family(t *testing.T) testpkg.ParentChain {
	t.Helper()
	chain := testpkg.CreateTestParentGuardianChain(t, f.s.db)
	_, err := f.s.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'parent', ?, 'test-p256dh', 'test-auth')`, chain.TenantID, chain.AccountID, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/room-parent-%d", chain.AccountID))
	require.NoError(t, err)
	return chain
}

// roomBlock is a planned block on date with its staff and children.
func (f *roomFeedFixture) roomBlock(t *testing.T, date calendar.Date, staff []feedPerson, children ...int64) int64 {
	t.Helper()
	instanceID := f.block(t, date, staff...)
	for _, child := range children {
		testpkg.CreateTestInstanceStudent(t, f.s.db, instanceID, child, "")
	}
	return instanceID
}

// edit saves the block as the actor with the room and title given; staff and
// children stay as they are.
func (f *roomFeedFixture) edit(t *testing.T, instanceID int64, actor feedPerson, roomID int64, title string) {
	t.Helper()
	f.editOn(t, instanceID, actor, roomID, title, "")
}

// editOn is edit that also moves the block to date (empty keeps its day).
func (f *roomFeedFixture) editOn(t *testing.T, instanceID int64, actor feedPerson, roomID int64, title string, date calendar.Date) {
	t.Helper()
	var row struct {
		Date      calendar.Date `bun:"date"`
		StartTime time.Time     `bun:"start_time"`
		EndTime   time.Time     `bun:"end_time"`
	}
	require.NoError(t, f.s.db.NewRaw(`SELECT date, start_time, end_time FROM schedule.activity_instances WHERE id = ?`, instanceID).Scan(context.Background(), &row))
	if date != "" {
		row.Date = date
	}
	var staffIDs, studentIDs []int64
	require.NoError(t, f.s.db.NewRaw(`SELECT staff_id FROM schedule.instance_staff WHERE instance_id = ?`, instanceID).Scan(context.Background(), &staffIDs))
	require.NoError(t, f.s.db.NewRaw(`SELECT student_id FROM schedule.instance_students WHERE instance_id = ?`, instanceID).Scan(context.Background(), &studentIDs))
	_, err := f.svc.UpdatePlanned(f.s.ctx, instanceID, timetable.UpdateInstanceInput{
		Date: row.Date, StartTime: row.StartTime, EndTime: row.EndTime, Title: title, RoomID: roomID,
		StaffIDs: staffIDs, StudentIDs: studentIDs,
	}, &actor.accountID)
	require.NoError(t, err)
}

func (f *roomFeedFixture) parentFeed(t *testing.T, accountID int64) feedResponse {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/parent/me/notifications/feed", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, testutil.ParentTestClaims(int(accountID)))))
	response := testutil.ExecuteRequestForTest(t, f.router, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var feed feedResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &feed))
	return feed
}

// parentPushes are the title and body of the account's pushes of the type.
func (f *roomFeedFixture) parentPushes(t *testing.T, accountID int64, notificationType string) []string {
	t.Helper()
	var texts []string
	require.NoError(t, f.s.db.NewRaw(`SELECT concat_ws(' | ', payload->>'title', payload->>'body') FROM platform.push_outbox
		WHERE tenant_id = ? AND (recipient->>'account_id')::bigint = ? AND payload->>'type' = ?`,
		testpkg.Tenant(t), accountID, notificationType).Scan(context.Background(), &texts))
	return texts
}

func TestRoomChangeReachesTheStaffingAndTheFamilies(t *testing.T) {
	t.Parallel()
	f := newRoomFeedFixture(t)
	actor, planned, unrelated := f.person(t, "Actor"), f.person(t, "Planned"), f.person(t, "Unrelated")
	parent, withoutAccess, notBooked := f.family(t), f.family(t), f.family(t)
	_, err := f.s.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, withoutAccess.GuardianProfileID)
	require.NoError(t, err)
	instanceID := f.roomBlock(t, calendar.NewDate(2030, 6, 11), []feedPerson{actor, planned}, parent.StudentID, withoutAccess.StudentID)

	// An edit that keeps the room tells nobody.
	f.edit(t, instanceID, actor, f.s.roomID, "Fußball-AG")
	assert.Empty(t, f.feed(t, planned, "").Data.Entries)

	f.edit(t, instanceID, actor, f.moveTo, "Fußball-AG")

	body := "„Fußball-AG“ am Di. 11.06. um " + entryStart(t, f.feedFixture, instanceID) + " Uhr findet jetzt in „" + f.to + "“ statt, nicht mehr in „" + f.from + "“."
	feed := f.feed(t, planned, "")
	require.Len(t, feed.Data.Entries, 1)
	entry := feed.Data.Entries[0]
	assert.Equal(t, "instance_room_changed", entry.Type, "tomorrow is a move soon")
	assert.Equal(t, "Raum geändert", entry.Title)
	assert.Equal(t, body, entry.Body)
	assert.Equal(t, "/mein-dienstplan?d=2030-06-11", entry.DeepLink)
	assert.Equal(t, 1, f.pushesOf(t, planned, "instance_room_changed"), "a move soon pushes by default")
	assert.Empty(t, f.feed(t, actor, "").Data.Entries, "the person who changed the room gets nothing")
	assert.Zero(t, f.pushesOf(t, actor, "instance_room_changed"))
	assert.Empty(t, f.feed(t, unrelated, "").Data.Entries, "who is not planned gets nothing")

	// moto schule shows the same entry with its own link (#7139).
	school := f.schoolFeed(t, planned)
	require.Len(t, school.Data.Entries, 1)
	assert.Equal(t, "/school/aufsichten", school.Data.Entries[0].DeepLink)

	// The family reads the block, the day and the room after login; the
	// lock screen names neither child nor block nor room.
	parentFeed := f.parentFeed(t, parent.AccountID)
	require.Len(t, parentFeed.Data.Entries, 1)
	assert.Equal(t, "parent_room_changed", parentFeed.Data.Entries[0].Type)
	assert.Equal(t, "Raum geändert", parentFeed.Data.Entries[0].Title)
	assert.Equal(t, body, parentFeed.Data.Entries[0].Body)
	assert.Equal(t, "/children", parentFeed.Data.Entries[0].DeepLink)
	pushes := f.parentPushes(t, parent.AccountID, "parent_room_changed")
	require.Len(t, pushes, 1, "a move soon pushes the family by default")
	for _, leak := range []string{"Felix", "Schneider", "Fußball", f.to, f.from} {
		assert.NotContains(t, pushes[0], leak, "no child, block or room on the lock screen")
	}
	assert.Empty(t, f.parentFeed(t, withoutAccess.AccountID).Data.Entries, "a guardian without parent_portal.access gets nothing")
	assert.Empty(t, f.parentPushes(t, withoutAccess.AccountID, "parent_room_changed"))
	assert.Empty(t, f.parentFeed(t, notBooked.AccountID).Data.Entries, "a family whose child is not booked gets nothing")

	// The audience scope is relationship-specific: a parent's entry must not
	// carry a co-booked child for whom that parent has no portal access.
	var parentStudentIDs []int64
	require.NoError(t, f.s.db.NewRaw(`SELECT student_ids FROM platform.notification_feed_entries
		WHERE tenant_id = ? AND account_id = ? AND type = 'parent_room_changed'`, testpkg.Tenant(t), parent.AccountID).
		Scan(context.Background(), pgdialect.Array(&parentStudentIDs)))
	assert.Equal(t, []int64{parent.StudentID}, parentStudentIDs)

	// Losing the right after the entry was written hides it.
	_, err = f.s.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, parent.GuardianProfileID)
	require.NoError(t, err)
	assert.Empty(t, f.parentFeed(t, parent.AccountID).Data.Entries, "the right is checked again on every read")
	_, err = f.s.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{"parent_portal.access": true}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, parent.GuardianProfileID)
	require.NoError(t, err)

	// A later move reaches the family's feed; the push only who switched it on.
	later := f.roomBlock(t, calendar.NewDate(2030, 6, 14), []feedPerson{actor, planned}, parent.StudentID)
	f.edit(t, later, actor, f.moveTo, "Fußball-AG")
	laterFeed := f.parentFeed(t, parent.AccountID)
	require.Len(t, laterFeed.Data.Entries, 2)
	assert.Equal(t, "parent_room_changed_later", laterFeed.Data.Entries[0].Type)
	assert.Empty(t, f.parentPushes(t, parent.AccountID, "parent_room_changed_later"), "a later move is off by default for families too")

	// Another school of the same person sees nothing of this school.
	foreign := testpkg.NewTenantScope(t, f.s.db)
	testpkg.MapAccountToTenant(t, f.s.db, planned.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.s.db, planned.accountID, foreign.TenantID)
	code, raw := f.call(t, planned.accountID, foreign.TenantID, http.MethodGet, "/api/notifications/feed")
	require.Equal(t, http.StatusOK, code, string(raw))
	var other feedResponse
	require.NoError(t, json.Unmarshal(raw, &other))
	assert.Empty(t, other.Data.Entries)
}

func TestRoomChangeFollowsTheDayTheSwitchesAndBundles(t *testing.T) {
	t.Parallel()
	f := newRoomFeedFixture(t)
	actor, planned, quiet, eager := f.person(t, "Actor"), f.person(t, "Planned"), f.person(t, "Quiet"), f.person(t, "Eager")
	f.typedConsent(quiet.accountID, "instance_room_changed", false)
	f.typedConsent(eager.accountID, "instance_room_changed_later", true)
	staff := []feedPerson{actor, planned, quiet, eager}

	// Today: a declined switch keeps the entry and drops the push.
	soon := f.roomBlock(t, calendar.NewDate(2030, 6, 10), staff)
	f.edit(t, soon, actor, f.moveTo, "Schach-AG")
	assert.Len(t, f.feed(t, quiet, "").Data.Entries, 1)
	assert.Zero(t, f.pushesOf(t, quiet, "instance_room_changed"))
	assert.Equal(t, 1, f.pushesOf(t, planned, "instance_room_changed"))

	// A second move of the same block within ten minutes, while unread,
	// updates the entry without a second push.
	f.edit(t, soon, actor, f.s.roomID, "Schach-AG")
	feed := f.feed(t, planned, "")
	require.Len(t, feed.Data.Entries, 1)
	assert.Contains(t, feed.Data.Entries[0].Body, "jetzt in „"+f.from+"“")
	assert.Equal(t, 1, f.pushesOf(t, planned, "instance_room_changed"))

	// In four days: the entry for everybody, the push only for who switched
	// it on.
	later := f.roomBlock(t, calendar.NewDate(2030, 6, 14), staff)
	f.edit(t, later, actor, f.moveTo, "Schach-AG")
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 2)
	assert.Equal(t, "instance_room_changed_later", f.feed(t, planned, "").Data.Entries[0].Type)
	assert.Zero(t, f.pushesOf(t, planned, "instance_room_changed_later"), "a later move is off by default")
	assert.Equal(t, 1, f.pushesOf(t, eager, "instance_room_changed_later"))

	// More than 14 days ahead: the feed only, also for who switched it on.
	far := f.roomBlock(t, calendar.NewDate(2030, 6, 25), staff)
	f.edit(t, far, actor, f.moveTo, "Schach-AG")
	assert.Len(t, f.feed(t, eager, "").Data.Entries, 3)
	assert.Equal(t, 1, f.pushesOf(t, eager, "instance_room_changed_later"))

	// A block moved from tomorrow to a day weeks ahead in the same edit is
	// urgent for whoever expected it tomorrow.
	moved := f.roomBlock(t, calendar.NewDate(2030, 6, 11), staff)
	f.editOn(t, moved, actor, f.moveTo, "Schach-AG", calendar.NewDate(2030, 7, 2))
	movedFeed := f.feed(t, planned, "")
	require.Len(t, movedFeed.Data.Entries, 4)
	assert.Equal(t, "instance_room_changed", movedFeed.Data.Entries[0].Type)
	assert.Contains(t, movedFeed.Data.Entries[0].Body, "am Di. 02.07.", "the text names the new day")
	assert.Equal(t, 2, f.pushesOf(t, planned, "instance_room_changed"))

	// A past block tells nobody.
	past := f.roomBlock(t, calendar.NewDate(2030, 6, 9), staff)
	f.edit(t, past, actor, f.moveTo, "Schach-AG")
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 4)

	// A school that switched the type off gets neither entry nor push.
	testpkg.SetTestTenantSetting(t, f.s.db, testpkg.Tenant(t), "notifications.instance_room_changed_enabled", "false")
	off := f.roomBlock(t, calendar.NewDate(2030, 6, 11), staff)
	f.edit(t, off, actor, f.moveTo, "Schach-AG")
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 4)
	assert.Equal(t, 2, f.pushesOf(t, planned, "instance_room_changed"))
}
