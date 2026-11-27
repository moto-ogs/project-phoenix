package parentportal_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	parentportal "github.com/moto-ogs/project-phoenix/workflows/parentportal"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentportalcompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
)

func buildCareServiceWithAutoExcusal(t *testing.T) (*parentportal.Portal, careplan.PickupAutoExcusal, *bun.DB) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	timetableOwner := owners.MustNewUnobservedTimetable(testpkg.NewDatabase(t, db))
	repos := api.NewRepositoryTestFactory(testpkg.NewDatabase(t, db))
	reposPeople := api.NewPeopleRepositorySuiteFactory(testpkg.NewDatabase(t, db))
	excusal := newPickupExcusal(t, db, repos.CarePlan(),
		newPickupBaselineService(repos.CarePlan(), approvedOfferingProjection(t)), timetableOwner, false)
	svc := parentportalcompose.New(parentportalcompose.Dependencies{
		Memberships:         parentMemberships(t, db),
		StudentGuardianRepo: guardStudentGuardians(t, db),
		GuardianProfileRepo: guardProfiles(t, db),
		GuardianChanges:     owners.ParentGuardianChanges(),
		DeparturePolicy:     owners.ParentDeparturePolicy(),
		GuardianPolicy:      owners.NewParentGuardianPolicy(),
		Fingerprints:        owners.SecurityFingerprints{},
		Declarations:        owners.ParentDeclarationPolicy(),
		Locales:             owners.ParentPortalLocales(),
		Runtime:             owners.ParentPortalRuntime{},
		CarePlan:            owners.NewParentCarePlanCommands(repos.CarePlan(), excusal),
		People:              owners.MustNewPeopleDirectory(testpkg.MustDatabase(db)),
		CareProfiles:        careProfiles(t, db),
		ChildRepo:           repos.ParentChildReads(),
		StatusDayRepo:       repos.StudentStatusDay,
		StudentRepo:         owners.NewParentStudentReads(reposPeople.Student),
		CareExceptions:      owners.NewParentCareExceptions(repos.CarePlan()),

		Settings: parentSettingsStub{
			boolValues: map[string]bool{parentportal.KeyParentPickupChangeEnabled: true},
		},
		StudentUpdates: owners.BindParentStudentUpdates(testpkg.NewRecordingBroadcaster()),
		Logger:         slog.Default(),
		Now:            careFixtureNow,

		DataRequests: owners.NewParentDataRequestCommands(repos.CarePlan()),

		CarePlanPolicy: owners.NewParentCarePlanPolicy(),
	})
	return svc, excusal, db
}

// nextMonday returns the first Monday at least seven days after the fixed
// test day, safely inside the parent submit window (today .. +2 months).
func nextMonday() calendar.Date {
	date := careFixtureToday().AddDays(7)
	for date.Weekday() != time.Monday {
		date = date.AddDays(1)
	}
	return date
}

func loadSlotRow(t *testing.T, db *bun.DB, rowID int64) *testpkg.InstanceStudent {
	t.Helper()
	return testpkg.InstanceStudentByIDContext(t, testpkg.WithPackageTenantRuntime(context.Background()), db, rowID)
}

func TestDeleteCareException_ReleasesAutoExcusedBlocks(t *testing.T) {
	t.Parallel()

	svc, excusal, db := buildCareServiceWithAutoExcusal(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	staff := testpkg.CreateTestStaff(t, db, "Parent", "Withdraw")
	room := testpkg.CreateTestRoom(t, db, "Parent withdraw room")

	date := nextMonday()
	testpkg.CreateTestPickupSchedule(t, db, chain.StudentID, 1, staff.ID, "16:00")
	block := testpkg.CreateTestActivityInstance(t, db, date, room.ID, testpkg.ActivityInstanceOpts{
		StartHHMM: "15:00", EndHHMM: "16:00", Title: "Nachmittags-AG",
	})
	slot := testpkg.CreateTestInstanceStudent(t, db, block.ID, chain.StudentID, testpkg.ScheduleAttendanceStatusExpected)

	ctx := testpkg.TenantContext(chain.TenantID)
	records := api.NewRepositoryTestFactory(testpkg.NewDatabase(t, db)).CarePlan()
	exceptionID := seedGuardianPickupException(t, db, chain, date, wallClock(14, 45))
	_, err := testpkg.TenantQuery1(t, ctx, db, excusal.Sync, exceptionID)
	require.NoError(t, err)
	require.Equal(t, testpkg.ScheduleAttendanceStatusAbsent, loadSlotRow(t, db, slot.ID).Status)

	require.NoError(t, svc.DeleteCareException(testpkg.WithPackageTenantRuntime(context.Background()), chain.AccountID, chain.StudentID, date))

	row := loadSlotRow(t, db, slot.ID)
	assert.Equal(t, testpkg.ScheduleAttendanceStatusExpected, row.Status)
	assert.Nil(t, row.PickupExceptionID)
	assert.Nil(t, row.Substatus)

	exception, err := api.FindParentPickupExceptionFixture(ctx, records, chain.StudentID, date)
	require.NoError(t, err)
	assert.Nil(t, exception, "withdrawing the override removes the guardian row")
}

// newPickupExcusal uses the same configured Timetable instance as the fixture's
// repositories, including its Care Plan reads and student-before-day locks.
func newPickupExcusal(t *testing.T, db *bun.DB, records careplan.Capability, baselines careplan.PickupBaselineReader, tt timetable.Capability, extensions bool) careplan.PickupAutoExcusal {
	t.Helper()
	adapter := owners.NewPickupExcusalTimetable(tt, owners.NewPartialAbsencePreview(testpkg.MustDatabase(db)))
	deps := compose.PickupExcusalDependencies{DB: db, Records: records, Baselines: baselines, Blocks: api.NewStudentPresenceForTests(testpkg.NewDatabase(t, db)), Preview: adapter, Today: calendar.TodayDate}
	if extensions {
		deps.Extensions = adapter
	}
	service, err := compose.NewPickupAutoExcusal(deps)
	require.NoError(t, err)
	return service
}
