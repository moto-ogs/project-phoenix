package notifications

import (
	"context"
	"errors"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/realtime"
)

// fakeGuardianAccess records the delivery-time access question and answers it
// from a fixed permitted set.
type fakeGuardianAccess struct {
	permitted  []int64
	err        error
	calls      int
	accountIDs []int64
	studentIDs []int64
	permission string
	tenantID   int64
}

func (f *fakeGuardianAccess) FilterAccountsWithStudentAccess(_ context.Context, guardianAccountIDs, studentIDs []int64, tenantID int64, permission string) ([]int64, error) {
	f.calls++
	f.accountIDs = guardianAccountIDs
	f.studentIDs = studentIDs
	f.tenantID = tenantID
	f.permission = permission
	return f.permitted, f.err
}

// recordingGuardianBroadcaster records guardian fan-out targets. It is local to
// this file because the shared RecordingBroadcaster lives in package test, which
// an internal test of this package cannot reach without an import cycle.
type recordingGuardianBroadcaster struct {
	guardians      []int64
	guardianEvents []realtime.Event
	staff          []int64
	schools        []int64
	err            error
	guardianErrors map[int64]error
	feedErr        error
	staffEvents    []realtime.Event
	schoolEvents   []realtime.Event
}

func (b *recordingGuardianBroadcaster) BroadcastToGuardian(_, guardianAccountID int64, event realtime.Event) error {
	b.guardians = append(b.guardians, guardianAccountID)
	b.guardianEvents = append(b.guardianEvents, event)
	if err, ok := b.guardianErrors[guardianAccountID]; ok {
		return err
	}
	return b.err
}

func (b *recordingGuardianBroadcaster) BroadcastToGroup(int64, string, realtime.Event) error {
	return nil
}
func (b *recordingGuardianBroadcaster) BroadcastToGroups(int64, []string, realtime.Event) error {
	return nil
}
func (b *recordingGuardianBroadcaster) BroadcastToTenant(int64, realtime.Event) error { return nil }
func (b *recordingGuardianBroadcaster) BroadcastToTenantAdmins(int64, realtime.Event) error {
	return nil
}

func (b *recordingGuardianBroadcaster) BroadcastParentMessage(int64, int64, realtime.Event) error {
	return nil
}
func (b *recordingGuardianBroadcaster) BroadcastLeadershipParentMessage(int64, int64, realtime.Event) error {
	return nil
}

func (b *recordingGuardianBroadcaster) BroadcastToStaffAccounts(_ int64, accountIDs []int64, event realtime.Event) error {
	b.staff = append(b.staff, accountIDs...)
	b.staffEvents = append(b.staffEvents, event)
	if event.Type == realtime.EventNotificationFeedChanged {
		return b.feedErr
	}
	return nil
}
func (b *recordingGuardianBroadcaster) BroadcastToSchoolAccounts(_ int64, accountIDs []int64, event realtime.Event) error {
	b.schools = append(b.schools, accountIDs...)
	b.schoolEvents = append(b.schoolEvents, event)
	if event.Type == realtime.EventNotificationFeedChanged {
		return b.feedErr
	}
	return nil
}

// mockDB returns a bun DB backed by sqlmock, asserting at teardown that exactly
// the expected statements ran.
func mockDB(t *testing.T) (*bun.DB, sqlmock.Sqlmock) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() {
		_ = sqlDB.Close()
		require.NoError(t, mock.ExpectationsWereMet())
	})
	return db, mock
}

// mockTenantTxDB returns a bun DB whose tenant transaction (BEGIN, combined
// role/tenant set_config, COMMIT/ROLLBACK) is satisfied by sqlmock; the access lookup
// itself is faked, so no statement inside the transaction is expected.
func mockTenantTxDB(t *testing.T, commits bool) *bun.DB {
	t.Helper()
	db, mock := mockDB(t)
	mock.ExpectBegin()
	mock.ExpectExec("^" + regexp.QuoteMeta("SELECT set_config('role', 'phoenix_tenant', true), set_config('app.current_tenant_id', '41', true)") + "$").WillReturnResult(sqlmock.NewResult(0, 0))
	if commits {
		mock.ExpectCommit()
	} else {
		mock.ExpectRollback()
	}
	return db
}

func guardianEvent(studentIDs []int64) Event {
	return Event{
		Type:     TypeParentMessage,
		Title:    "Neue Nachricht der OGS",
		Body:     "Sie haben eine neue Nachricht im Elternportal.",
		DeepLink: "/messages",
		Priority: PriorityNormal,
		Audience: Audience{
			TenantID:           41,
			Scope:              ScopeGuardian,
			GuardianAccountIDs: []int64{77, 88},
			StudentIDs:         studentIDs,
		},
	}
}

// TestSSEGuardianFanOutRechecksChildAccess is the SSE half of the #1671
// delivery-time authorization contract: an in-app notification carries the same
// title, body and deep link a push does, so a guardian whose access to the child
// was revoked after the producer resolved its audience must not be woken either.
func TestSSEGuardianFanOutRechecksChildAccess(t *testing.T) {
	t.Parallel()

	broadcaster := &recordingGuardianBroadcaster{}
	access := &fakeGuardianAccess{permitted: []int64{88}}
	channel := newMockSSEChannel(t, broadcaster, WithGuardianChildAccess(mockTenantTxDB(t, true), access, nil))

	require.NoError(t, channel.Deliver(context.Background(), guardianEvent([]int64{55})))

	assert.Equal(t, []int64{88}, broadcaster.guardians,
		"only the guardians who still hold parent_portal.access may be woken")
	assert.Equal(t, 1, access.calls)
	assert.Equal(t, []int64{77, 88}, access.accountIDs)
	assert.Equal(t, []int64{55}, access.studentIDs)
	assert.Equal(t, int64(41), access.tenantID)
	assert.Equal(t, "parent_portal.access", access.permission)
}

// TestSSEGuardianFanOutSkipsRecheckWithoutChildren keeps events that are about no
// child at all (broadcast announcements, gated by their own producer) on the
// unchanged path — no lookup, every resolved recipient woken.
func TestSSEGuardianFanOutSkipsRecheckWithoutChildren(t *testing.T) {
	t.Parallel()

	broadcaster := &recordingGuardianBroadcaster{}
	access := &fakeGuardianAccess{}
	db, _ := mockDB(t) // no statement expected: the unchanged path opens no transaction
	channel := newMockSSEChannel(t, broadcaster, WithGuardianChildAccess(db, access, nil))

	require.NoError(t, channel.Deliver(context.Background(), guardianEvent(nil)))

	assert.Equal(t, []int64{77, 88}, broadcaster.guardians)
	assert.Zero(t, access.calls, "an audience about no child has nothing to re-check")
}

// TestSSEGuardianFanOutFailsClosedWithoutAccessLookup covers a channel built
// without the lookup: a student-scoped event is dropped rather than delivered
// unchecked.
func TestSSEGuardianFanOutFailsClosedWithoutAccessLookup(t *testing.T) {
	t.Parallel()

	broadcaster := &recordingGuardianBroadcaster{}
	channel := newMockSSEChannel(t, broadcaster)

	require.NoError(t, channel.Deliver(context.Background(), guardianEvent([]int64{55})))

	assert.Empty(t, broadcaster.guardians)
}

// TestSSEGuardianFanOutReportsLookupFailure keeps a failed access read from
// silently delivering to everyone: the router logs the returned error and no
// guardian is woken.
func TestSSEGuardianFanOutReportsLookupFailure(t *testing.T) {
	t.Parallel()

	broadcaster := &recordingGuardianBroadcaster{}
	access := &fakeGuardianAccess{err: errors.New("access lookup failed")}
	channel := newMockSSEChannel(t, broadcaster, WithGuardianChildAccess(mockTenantTxDB(t, false), access, nil))

	err := channel.Deliver(context.Background(), guardianEvent([]int64{55}))

	require.ErrorContains(t, err, "access lookup failed")
	assert.Empty(t, broadcaster.guardians)
}

func TestSSESchoolPortalFanOutSkipsAnUnbookedModule(t *testing.T) {
	t.Parallel()

	event := Event{
		Type:     TypeStaffMessage,
		Audience: Audience{TenantID: 41, Scope: ScopeStaff, StaffAccountIDs: []int64{7}},
	}
	closed := &router{settings: moduleSwitchStub{"module.unterricht_vormittag": false}}
	deliver, err := closed.applyModuleBooking(context.Background(), &event)
	require.NoError(t, err)
	require.True(t, deliver, "the staff portal remains open")

	broadcaster := &recordingGuardianBroadcaster{}
	channel := newMockSSEChannel(t, broadcaster)
	require.NoError(t, channel.Deliver(context.Background(), event))

	assert.Equal(t, []int64{7}, broadcaster.staff)
	assert.Empty(t, broadcaster.schools, "the school portal must not receive events after its module is cancelled")
}

func TestSSEStaffNotificationSurvivesFeedInvalidationFailure(t *testing.T) {
	t.Parallel()

	broadcaster := &recordingGuardianBroadcaster{feedErr: errors.New("feed invalidation failed")}
	channel := newMockSSEChannel(t, broadcaster)
	event := Event{
		Type:        TypeInstanceCancelled,
		Title:       "Termin abgesagt",
		Body:        "Ein Termin fällt aus.",
		DeepLink:    "/instances/1",
		Priority:    PriorityNormal,
		feedChanged: []int64{7},
		Audience: Audience{
			TenantID:        41,
			Scope:           ScopeStaff,
			StaffAccountIDs: []int64{7},
		},
	}

	require.NoError(t, channel.Deliver(context.Background(), event))
	require.Len(t, broadcaster.staffEvents, 2)
	require.Len(t, broadcaster.schoolEvents, 2)
	assert.Equal(t, []realtime.EventType{realtime.EventNotificationFeedChanged, realtime.EventNotification}, []realtime.EventType{
		broadcaster.staffEvents[0].Type, broadcaster.staffEvents[1].Type,
	})
	assert.Equal(t, []realtime.EventType{realtime.EventNotificationFeedChanged, realtime.EventNotification}, []realtime.EventType{
		broadcaster.schoolEvents[0].Type, broadcaster.schoolEvents[1].Type,
	})
}

func TestSSEGuardianNotificationSurvivesFeedInvalidationFailure(t *testing.T) {
	t.Parallel()

	feedErr := errors.New("feed invalidation failed")
	broadcaster := &recordingGuardianBroadcaster{guardianErrors: map[int64]error{77: feedErr}}
	channel := newMockSSEChannel(t, broadcaster)
	event := guardianEvent(nil)
	event.feedChanged = []int64{77, 88}
	event.Audience.GuardianAccountIDs = []int64{88}

	require.NoError(t, channel.Deliver(context.Background(), event))
	assert.Equal(t, []int64{77, 88, 88}, broadcaster.guardians)
	require.Len(t, broadcaster.guardianEvents, 3)
	assert.Equal(t, []realtime.EventType{
		realtime.EventNotificationFeedChanged,
		realtime.EventNotificationFeedChanged,
		realtime.EventNotification,
	}, []realtime.EventType{
		broadcaster.guardianEvents[0].Type,
		broadcaster.guardianEvents[1].Type,
		broadcaster.guardianEvents[2].Type,
	})
}

func TestSSEGuardianFanOutContinuesAfterBroadcastFailure(t *testing.T) {
	t.Parallel()

	firstErr := errors.New("first guardian unavailable")
	secondErr := errors.New("second guardian unavailable")
	broadcaster := &recordingGuardianBroadcaster{guardianErrors: map[int64]error{
		77: firstErr,
		88: secondErr,
	}}
	channel := newMockSSEChannel(t, broadcaster)

	err := channel.Deliver(context.Background(), guardianEvent(nil))

	require.Error(t, err)
	assert.ErrorIs(t, err, firstErr)
	assert.ErrorIs(t, err, secondErr)
	assert.Equal(t, []int64{77, 88}, broadcaster.guardians)
}
