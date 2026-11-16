package main

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDemoReadsWebAttributionFromSchoolStayWithoutRoomVisit(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	student := testpkg.CreateTestStudent(t, db, "Demo", "Web", "3a")
	staff := testpkg.CreateTestStaff(t, db, "Demo", "Staff")
	web := testpkg.EnsureWebManualDevice(t, db)
	today := demoSnapshotDay()
	arrival := today.BerlinMidnight().Add(8 * time.Hour)
	testpkg.CreateTestAttendanceForDate(t, db, student.ID, staff.ID, web.ID, today, arrival, nil)
	runtime, err := NewDemoRuntime(testpkg.NewDatabase(t, db), demoSnapshotClock(arrival.Add(time.Minute)), newSeedCommandAdapter, t.TempDir())
	require.NoError(t, err)
	visits, err := runtime.LatestDemoVisits(testpkg.Ctx(t), web.ID, today.AddDays(-1).String(), today.String())
	require.NoError(t, err)
	require.Len(t, visits, 1)
	assert.Equal(t, student.ID, visits[0].StudentID)
	assert.True(t, visits[0].Web)
	assert.WithinDuration(t, arrival, visits[0].ChangedAt, time.Microsecond)
	assert.False(t, visits[0].Active, "school attendance alone is not a room visit")
}

func TestDemoReadsWebCheckoutOfPhysicalSchoolStay(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	student := testpkg.CreateTestStudent(t, db, "Demo", "Departure", "3a")
	staff := testpkg.CreateTestStaff(t, db, "Demo", "Departure")
	physical := testpkg.CreateTestDevice(t, db, "demo-physical")
	web := testpkg.EnsureWebManualDevice(t, db)
	today := demoSnapshotDay()
	departure := today.BerlinMidnight().Add(15 * time.Hour)
	stay := testpkg.CreateTestAttendanceForDate(t, db, student.ID, staff.ID, physical.ID, today, departure.Add(-time.Hour), nil)
	// Both web checkout endpoints record the staff but no physical device.
	testpkg.CheckOutTestAttendanceByStaff(t, db, student.ID, stay.Date, departure, staff.ID)
	runtime, err := NewDemoRuntime(testpkg.NewDatabase(t, db), demoSnapshotClock(departure.Add(time.Minute)), newSeedCommandAdapter, t.TempDir())
	require.NoError(t, err)
	visits, err := runtime.LatestDemoVisits(testpkg.Ctx(t), web.ID, today.AddDays(-1).String(), today.String())
	require.NoError(t, err)
	require.Len(t, visits, 1)
	assert.True(t, visits[0].Web)
	assert.False(t, visits[0].Active)
	assert.WithinDuration(t, departure, visits[0].ChangedAt, time.Microsecond)
}

// demoSnapshotDay is the fixed school day the snapshot tests read: a
// Wednesday, independent of the day the test runs.
func demoSnapshotDay() calendar.Date { return calendar.NewDate(2026, time.November, 18) }

// demoSnapshotClock is the runtime's clock, stopped at at.
func demoSnapshotClock(at time.Time) func() time.Time { return func() time.Time { return at } }

// The queue smoke invokes this expiry before it claims any prospect order.
// A superuser fixture would hide a forbidden SET LOCAL ROLE phoenix_admin.
func TestDemoQueueExpiryUsesTheRestrictedLogin(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	demo := testpkg.DemoRoleDatabase(t, db)
	var member bool
	require.NoError(t, demo.NewRaw("SELECT pg_has_role(current_user, 'phoenix_admin', 'MEMBER')").Scan(t.Context(), &member))
	require.False(t, member)
	database := testpkg.NewDemoDatabase(t, demo)
	runtime, err := NewDemoRuntime(database, time.Now, newSeedCommandAdapter, t.TempDir())
	require.NoError(t, err)
	_, _, err = runtime.ExpireDemoAccesses(t.Context())
	require.NoError(t, err)
	testpkg.AssertRestrictedDemoUnit(t, demo)
}
