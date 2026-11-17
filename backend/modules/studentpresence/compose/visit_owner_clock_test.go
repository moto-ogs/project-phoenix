package compose_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// visitOwnerDay lies years before the database clock: a visit stamped or
// ended by the database would land on another day than the owner's clock
// dates it (ADR 0281).
var visitOwnerDay = calendar.NewDate(2020, 3, 10)

func visitOwnerNoon() time.Time { return visitOwnerDay.BerlinMidnight().Add(12 * time.Hour) }

type visitOwnerFixture struct {
	module  studentpresence.Owner
	db      *bun.DB
	now     time.Time
	student int64
	room    int64
	group   int64
}

func newVisitOwnerFixture(t *testing.T) *visitOwnerFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	f := &visitOwnerFixture{now: visitOwnerNoon(), db: db}
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}, Now: func() time.Time { return f.now }})
	require.NoError(t, err)
	f.module = module
	f.student = testpkg.CreateTestPrivacyConsent(t, db, "OwnerClock").StudentID
	activity := testpkg.CreateTestActivityGroup(t, db, "Owner clock")
	room := testpkg.CreateTestRoom(t, db, "Owner clock")
	f.room, f.group = room.ID, testpkg.CreateTestActiveGroup(t, db, activity.ID, room.ID).ID
	return f
}

func (f *visitOwnerFixture) record(t *testing.T, entry time.Time, exit *time.Time) studentpresence.Visit {
	t.Helper()
	visit, err := f.module.RecordVisit(testpkg.Ctx(t), studentpresence.Visit{StudentID: f.student, ActiveGroupID: f.group, EntryTime: entry, ExitTime: exit})
	require.NoError(t, err)
	return visit
}

func TestCloseGroupVisitsEndsOnTheOwnersInstant(t *testing.T) {
	t.Parallel()
	f := newVisitOwnerFixture(t)
	visit := f.record(t, f.now.Add(-time.Hour), nil)
	count, err := f.module.CloseGroupVisits(testpkg.Ctx(t), []int64{f.group})
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	stored, err := f.module.FindVisit(testpkg.Ctx(t), visit.ID)
	require.NoError(t, err)
	require.NotNil(t, stored.ExitTime)
	assert.True(t, stored.ExitTime.Equal(f.now), "exit %s, want the owner's %s", stored.ExitTime, f.now)
}

func TestRoomUtilizationEndsAnOpenVisitOnTheOwnersInstant(t *testing.T) {
	t.Parallel()
	f := newVisitOwnerFixture(t)
	f.record(t, f.now.Add(-2*time.Hour), nil)
	start := visitOwnerDay.BerlinMidnight()
	rows, err := f.module.RoomUtilization(testpkg.Ctx(t), []studentpresence.StudentVisitWindow{{StudentID: f.student, StartAt: start, EndAt: start.AddDate(0, 0, 1)}})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, 120, rows[0].StudentMinutes, "the open visit runs until the owner's now")
}

func TestVisitRetentionAgesVisitsOnTheOwnersClock(t *testing.T) {
	t.Parallel()
	f := newVisitOwnerFixture(t)
	exit := f.now
	f.record(t, f.now.Add(-time.Hour), &exit)
	f.now = f.now.AddDate(0, 0, 40)
	policy := studentpresence.VisitRetentionPolicy{DefaultDays: 30}
	counts, err := f.module.ListVisitRetentionCounts(testpkg.Ctx(t), policy)
	require.NoError(t, err)
	require.Len(t, counts, 1, "the visit was recorded 40 owner days ago, past its 30-day consent window")
	deleted, err := f.module.DeleteExpiredVisits(testpkg.Ctx(t), counts, f.now)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{f.student: 1}, deleted)
}

func TestTraegerRoomDaysCountVisitsWithinTheOwnersRetention(t *testing.T) {
	t.Parallel()
	f := newVisitOwnerFixture(t)
	exit := f.now
	f.record(t, f.now.Add(-time.Hour), &exit)
	now := f.now
	series := compose.NewPresenceSeries(func() time.Time { return now })
	days := func() int {
		var children int
		require.NoError(t, testpkg.WithinAdminContext(t, context.Background(), f.db, func(adminCtx context.Context) error {
			result, err := series.RoomDaysByTenant(adminCtx, []int64{testpkg.Tenant(t)}, visitOwnerDay, visitOwnerDay)
			for _, day := range result[testpkg.Tenant(t)].Days {
				children += day.Children
			}
			return err
		}))
		return children
	}
	require.Equal(t, 1, days(), "within the 30-day consent window the visit counts")
	now = now.AddDate(0, 0, 40)
	assert.Zero(t, days(), "40 owner days later the visit is past its retention")
}
