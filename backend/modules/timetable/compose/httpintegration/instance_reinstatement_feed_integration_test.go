package httpintegration_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Taking back a cancellation (#7151) is tested from the outside like the
// cancellation itself: the block is reinstated through the real lifecycle,
// Delivery writes the feed and the push outbox in that transaction, and each
// account reads its own feed through the staff portal's routes.

// reinstateIn runs the reinstatement in a tenant transaction, as the route
// does.
func (f *feedFixture) reinstateIn(t *testing.T, instanceID int64, actor feedPerson) (*timetable.LifecycleInstance, error) {
	t.Helper()
	var instance *timetable.LifecycleInstance
	err := testpkg.WithinTenantTransaction(f.s.ctx, f.s.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		var reinstateErr error
		instance, reinstateErr = f.reinstate.Reinstate(txCtx, instanceID, &actor.accountID)
		return reinstateErr
	})
	return instance, err
}

func (f *feedFixture) reinstated(t *testing.T, instanceID int64, actor feedPerson) *timetable.LifecycleInstance {
	t.Helper()
	instance, err := f.reinstateIn(t, instanceID, actor)
	require.NoError(t, err)
	return instance
}

func (f *feedFixture) markRead(t *testing.T, person feedPerson, entryID int64) {
	t.Helper()
	code, body := f.call(t, person.accountID, testpkg.Tenant(t), http.MethodPost, fmt.Sprintf("/api/notifications/feed/%d/read", entryID))
	require.Equal(t, http.StatusOK, code, string(body))
}

func TestReinstatementFeedReachesThePlannedStaffAndBundles(t *testing.T) {
	t.Parallel()
	f := newFeedFixture(t)
	actor, unread, read, quiet, unrelated := f.person(t, "Actor"), f.person(t, "Unread"), f.person(t, "Read"), f.person(t, "Quiet"), f.person(t, "Unrelated")
	f.consentDB(quiet.accountID, false)
	instanceID := f.block(t, calendar.NewDate(2030, 6, 11), actor, unread, read, quiet)
	f.cancel(t, instanceID, actor)
	f.markRead(t, read, f.feed(t, read, "").Data.Entries[0].ID)

	instance := f.reinstated(t, instanceID, actor)

	assert.Equal(t, timetable.InstanceStatusPlanned, instance.Status)
	body := "„Fußball-AG“ am Di. 11.06. um " + entryStart(t, f, instanceID) + " Uhr findet doch statt."

	// The unread cancellation is updated within the bundle window: one entry,
	// now "findet doch statt", and no second push.
	feed := f.feed(t, unread, "")
	require.Len(t, feed.Data.Entries, 1)
	assert.Equal(t, "instance_reinstated", feed.Data.Entries[0].Type)
	assert.Equal(t, "Termin findet doch statt", feed.Data.Entries[0].Title)
	assert.Equal(t, body, feed.Data.Entries[0].Body)
	assert.Equal(t, "/mein-dienstplan?d=2030-06-11", feed.Data.Entries[0].DeepLink)
	assert.Equal(t, 1, feed.Data.UnreadCount)
	assert.Equal(t, 1, f.pushes(t, unread))
	assert.Zero(t, f.pushesOf(t, unread, "instance_reinstated"))

	// Who already read the cancellation gets a new entry, pushed like the
	// cancellation was: the block lies within 14 days.
	feed = f.feed(t, read, "")
	require.Len(t, feed.Data.Entries, 2)
	assert.Equal(t, "instance_reinstated", feed.Data.Entries[0].Type)
	assert.Equal(t, body, feed.Data.Entries[0].Body)
	assert.Equal(t, "instance_cancelled", feed.Data.Entries[1].Type)
	assert.Equal(t, 1, f.pushesOf(t, read, "instance_reinstated"))

	// The switch for cancellations holds back the push of the reinstatement
	// as well, never its feed entry.
	assert.Len(t, f.feed(t, quiet, "").Data.Entries, 1)
	assert.Zero(t, f.pushes(t, quiet)+f.pushesOf(t, quiet, "instance_reinstated"))

	assert.Empty(t, f.feed(t, actor, "").Data.Entries, "the person who reinstated gets nothing")
	assert.Empty(t, f.feed(t, unrelated, "").Data.Entries, "who was not planned gets nothing")

	// The Änderungsprotokoll records the reinstatement with its actor.
	var events []struct {
		EventType      string `bun:"event_type"`
		ActorAccountID *int64 `bun:"actor_account_id"`
	}
	require.NoError(t, f.s.db.NewRaw(`SELECT event_type, actor_account_id FROM audit.deviation_events
		WHERE instance_id = ? ORDER BY id`, instanceID).Scan(context.Background(), &events))
	require.Len(t, events, 2)
	assert.Equal(t, "cancellation", events[0].EventType)
	assert.Equal(t, "reinstatement", events[1].EventType)
	require.NotNil(t, events[1].ActorAccountID)
	assert.Equal(t, actor.accountID, *events[1].ActorAccountID)

	// A renewed cancellation is possible again and bundles into the unread
	// reinstatement.
	f.cancel(t, instanceID, actor)
	feed = f.feed(t, unread, "")
	require.Len(t, feed.Data.Entries, 1)
	assert.Equal(t, "instance_cancelled", feed.Data.Entries[0].Type)
}

func TestReinstatementPushesWhenTheCancellationDidAndOnlyBeforeTheEnd(t *testing.T) {
	t.Parallel()
	f := newFeedFixture(t)
	actor, planned := f.person(t, "Actor"), f.person(t, "Planned")

	// More than 14 days ahead: the cancellation reached the feed only, and
	// so does its reinstatement.
	far := f.block(t, calendar.NewDate(2030, 6, 25), actor, planned)
	f.cancel(t, far, actor)
	f.markRead(t, planned, f.feed(t, planned, "").Data.Entries[0].ID)
	f.reinstated(t, far, actor)
	assert.Len(t, f.feed(t, planned, "").Data.Entries, 2)
	assert.Zero(t, f.pushesOf(t, planned, "instance_reinstated"))

	// A block that already ran when it was cancelled returns as planned
	// without its ended session, and starts again with a new one.
	running := f.block(t, calendar.NewDate(2030, 6, 12), actor, planned)
	started, err := f.svc.Start(f.s.ctx, running, planned.staffID)
	require.NoError(t, err)
	f.cancel(t, running, actor)
	instance := f.reinstated(t, running, actor)
	assert.Equal(t, timetable.InstanceStatusPlanned, instance.Status)
	assert.Nil(t, instance.ActiveGroupID)
	restarted, err := f.svc.Start(f.s.ctx, running, planned.staffID)
	require.NoError(t, err)
	assert.NotEqual(t, started.ActiveGroupID, restarted.ActiveGroupID)

	// An ended block keeps its cancellation: yesterday's, and today's after
	// its end (the clock stands at 10:00).
	yesterday := f.block(t, calendar.NewDate(2030, 6, 9), actor, planned)
	f.cancel(t, yesterday, actor)
	_, err = f.reinstateIn(t, yesterday, actor)
	require.ErrorIs(t, err, timetable.ErrInstanceReinstateEnded)
	morning := testpkg.CreateTestActivityInstance(t, f.s.db, calendar.NewDate(2030, 6, 10), f.s.roomID, testpkg.ActivityInstanceOpts{Title: "Frühbetreuung", StartHHMM: "07:00", EndHHMM: "08:00"})
	f.cancel(t, morning.ID, actor)
	_, err = f.reinstateIn(t, morning.ID, actor)
	require.ErrorIs(t, err, timetable.ErrInstanceReinstateEnded)

	// Outside a tenant transaction nothing happens.
	_, err = f.reinstate.Reinstate(f.s.ctx, yesterday, &actor.accountID)
	require.ErrorContains(t, err, "requires the tenant transaction")

	// Only a cancelled block is reinstated, and a deleted one is gone.
	plannedBlock := f.block(t, calendar.NewDate(2030, 6, 13), actor, planned)
	_, err = f.reinstateIn(t, plannedBlock, actor)
	require.ErrorIs(t, err, timetable.ErrInvalidInstanceTransition)
	f.cancel(t, plannedBlock, actor)
	require.NoError(t, testpkg.WithinTenantTransaction(f.s.ctx, f.s.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		return f.svc.DeleteCancelled(txCtx, plannedBlock)
	}))
	_, err = f.reinstateIn(t, plannedBlock, actor)
	require.ErrorIs(t, err, timetable.ErrInstanceNotFound)

	// A school that switched cancellation notices off hears of no
	// reinstatement either.
	entries := len(f.feed(t, planned, "").Data.Entries)
	testpkg.SetTestTenantSetting(t, f.s.db, testpkg.Tenant(t), "notifications.instance_cancelled_enabled", "false")
	gated := f.block(t, calendar.NewDate(2030, 6, 14), actor, planned)
	f.cancel(t, gated, actor)
	f.reinstated(t, gated, actor)
	assert.Len(t, f.feed(t, planned, "").Data.Entries, entries)
}
