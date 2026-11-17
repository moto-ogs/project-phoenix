// The parents portal for a child of the class without an OGS place (#4803,
// ADR 0282).
//
// The family keeps the school's functions through its relationship: sick
// notes, the parent-teacher conference, master data and contacts. Every OGS
// function of the child is switched off in the features and refused on the
// route with its own error. A parent without a relationship to the child
// sees nothing of it.
package parentportal_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/careplan/absencerecords"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
	parentportalcompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
)

// buildAllOnParentPortal wires the portal with every school switch on and no
// approval gate, so a flag that is off can only come from the child.
func buildAllOnParentPortal(t *testing.T, db *bun.DB) *parentService.Portal {
	t.Helper()
	repos := api.NewRepositoryTestFactory(testpkg.NewDatabase(t, db))
	reposPeople := api.NewPeopleRepositorySuiteFactory(testpkg.NewDatabase(t, db))
	bc := testpkg.NewRecordingBroadcaster()
	excused, err := api.NewTestExcusedAbsenceRequests(api.ExcusedRequestTestOptions{
		CarePlan: repos.CarePlan(), Logger: slog.Default(),
		Today: careFixtureToday,
	}, api.ExcusedRequestTestPeople{Students: reposPeople.Student, Persons: reposPeople.Person}, nil, bc)
	require.NoError(t, err)
	return parentportalcompose.New(parentportalcompose.Dependencies{
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
		CarePlan:            owners.NewParentCarePlanCommands(repos.CarePlan(), nil),
		People:              owners.MustNewPeopleDirectory(testpkg.MustDatabase(db)),
		CareProfiles:        careProfiles(t, db),
		ChildRepo:           repos.ParentChildReads(),
		StatusDayRepo:       repos.StudentStatusDay,
		StudentRepo:         owners.NewParentStudentReads(reposPeople.Student),
		CareExceptions:      owners.NewParentCareExceptions(repos.CarePlan()),
		Settings: parentSettingsStub{
			boolDefault: true,
			boolValues: map[string]bool{
				parentService.KeyParentSickRequiresApproval:    false,
				parentService.KeyParentExcusedRequiresApproval: false,
			},
			stringValues: map[string]string{
				parentService.KeyGuardianParentInviteMode: parentService.ParentInviteModeDisabled,
			},
		},
		MealPlan:        availableMealPlan(true),
		StudentUpdates:  owners.BindParentStudentUpdates(bc),
		ExcusedRequests: owners.NewParentExcusedAbsenceRequests(excused),
		Logger:          slog.Default(),
		Now:             careFixtureNow,

		DataRequests: owners.NewParentDataRequestCommands(repos.CarePlan()),

		CarePlanPolicy: owners.NewParentCarePlanPolicy(),
	})
}

func TestParentPortal_ChildWithoutCarePlace(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	svc := buildAllOnParentPortal(t, db)
	ctx := testpkg.WithPackageTenantRuntime(context.Background())

	// The family of a child with an OGS place at the same school is the
	// control: what it gets, the school has switched on.
	withPlace := testpkg.CreateTestParentGuardianChain(t, db)
	without := testpkg.CreateTestParentGuardianChain(t, db)
	testpkg.MarkTestStudentWithoutCarePlace(t, db, without.StudentID)

	t.Run("the child list names the missing OGS place", func(t *testing.T) {
		children, err := svc.ListChildrenForAccount(ctx, without.AccountID)
		require.NoError(t, err)
		require.Len(t, children, 1, "the child stays in the portal")
		assert.True(t, children[0].WithoutCarePlace)
	})

	t.Run("OGS flags go off, the school's flags stay", func(t *testing.T) {
		control, err := svc.ChildFeatures(ctx, withPlace.AccountID, withPlace.StudentID)
		require.NoError(t, err)
		require.False(t, control.WithoutCarePlace)
		require.True(t, control.NotesEnabled, "the control proves the school switched the chat on")
		require.True(t, control.PickupChangeEnabled)
		require.True(t, control.PickupManageAllowed)
		require.True(t, control.MealPlanEnabled)

		flags, err := svc.ChildFeatures(ctx, without.AccountID, without.StudentID)
		require.NoError(t, err)
		assert.True(t, flags.WithoutCarePlace, "the portal is told why the OGS blocks are missing")
		assert.False(t, flags.CareEnded, "a child without an OGS place has not left the school")
		assert.False(t, flags.NotesEnabled, "no chat with the OGS team")
		assert.False(t, flags.PickupChangeEnabled)
		assert.False(t, flags.PickupChangeModeEnabled)
		assert.False(t, flags.PickupManageAllowed)
		assert.True(t, flags.EmergencyContactManageAllowed)
		assert.False(t, flags.MealPlanEnabled)
		assert.False(t, flags.MealRegistrationEnabled)

		assert.True(t, flags.SickNoteEnabled)
		assert.True(t, flags.ExcusedNoteEnabled)
		assert.True(t, flags.ConferenceBookAllowed)
		assert.Equal(t, control.MasterDataEditEnabled, flags.MasterDataEditEnabled)
		assert.Equal(t, control.MasterDataRequestEnabled, flags.MasterDataRequestEnabled)
		assert.Equal(t, control.GuardianContactManageAllowed, flags.GuardianContactManageAllowed)
		assert.Equal(t, control.NewsEnabled, flags.NewsEnabled)
	})

	t.Run("a sick note goes through", func(t *testing.T) {
		result, err := svc.SubmitSickNote(ctx, without.AccountID, without.StudentID,
			[]calendar.Date{careFixtureToday().AddDays(1)}, "Fieber",
			absencerecords.StudentStatusDaySick, nil)
		require.NoError(t, err)
		assert.NotEmpty(t, result.StatusDays)
	})

	t.Run("the parent-teacher conference stays bookable", func(t *testing.T) {
		booked := false
		err := svc.WithParentConferenceBooking(ctx, without.AccountID, without.StudentID,
			func(context.Context, *parentService.Child) error {
				booked = true
				return nil
			})
		require.NoError(t, err)
		assert.True(t, booked)
		_, err = svc.ParentConferenceChild(ctx, without.AccountID, without.StudentID, false)
		require.NoError(t, err, "the family sees the coming conference days")
	})

	t.Run("OGS writes are refused with their own error", func(t *testing.T) {
		pickup := time.Date(2026, 8, 25, 15, 0, 0, 0, time.UTC)
		_, err := svc.SubmitCareExceptionWithReason(ctx, without.AccountID, without.StudentID,
			careFixtureToday().AddDays(1), &pickup, "Arzttermin")
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		_, err = svc.PostChildMessage(ctx, without.AccountID, without.StudentID, "Hallo")
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		err = svc.SetMealParticipationDay(ctx, without.AccountID, without.StudentID,
			careFixtureToday().AddDays(1), true)
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		_, err = svc.CreateCareScheduleRequest(ctx, without.AccountID, without.StudentID,
			map[string]any{"note": "Montag früher"})
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		// A pickup note alone asks for OGS pickup too.
		note := "holt dienstags ab"
		_, err = svc.CreateGuardianContact(ctx, without.AccountID, without.StudentID, parentService.CreateGuardianContactInput{
			Contact:          parentService.GuardianContactInput{FirstName: "Oma", LastName: "Platz"},
			RelationshipType: "other",
			PickupNotes:      &note,
		})
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)
	})

	t.Run("OGS reads are refused with their own error", func(t *testing.T) {
		_, err := svc.ListCareExceptions(ctx, without.AccountID, without.StudentID,
			careFixtureToday(), careFixtureToday().AddDays(7))
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		_, err = svc.GetChildCareSchedule(ctx, without.AccountID, without.StudentID)
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		_, err = svc.GetChildConversation(ctx, without.AccountID, without.StudentID)
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)

		_, err = svc.MealPlanWeek(ctx, without.AccountID, without.StudentID, careFixtureToday())
		require.ErrorIs(t, err, parentService.ErrChildWithoutCarePlace)
	})

	t.Run("a parent without a relationship to the child sees nothing", func(t *testing.T) {
		_, err := svc.ChildFeatures(ctx, withPlace.AccountID, without.StudentID)
		require.ErrorIs(t, err, parentService.ErrChildNotLinked)

		_, err = svc.SubmitSickNote(ctx, withPlace.AccountID, without.StudentID,
			[]calendar.Date{careFixtureToday().AddDays(2)}, "Fieber",
			absencerecords.StudentStatusDaySick, nil)
		require.ErrorIs(t, err, parentService.ErrChildNotLinked)

		_, err = svc.ParentConferenceChild(ctx, withPlace.AccountID, without.StudentID, false)
		require.ErrorIs(t, err, parentService.ErrChildNotLinked)

		children, err := svc.ListChildrenForAccount(ctx, withPlace.AccountID)
		require.NoError(t, err)
		for _, child := range children {
			assert.NotEqual(t, without.StudentID, child.StudentID)
		}
	})
}
