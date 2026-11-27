package parentportal_test

import (
	"context"
	"log/slog"
	"testing"

	parentportal "github.com/moto-ogs/project-phoenix/workflows/parentportal"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/communication/communicationtest"
	"github.com/moto-ogs/project-phoenix/realtime"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentportalcompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
)

func TestDeleteCareException_EmitsCorrectionAndWakesGuardians(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	repos := api.NewRepositoryTestFactory(testpkg.NewDatabase(t, db))
	reposMessages := api.NewParentMessagingSuiteRepositories(testpkg.NewDatabase(t, db))
	reposPeople := api.NewPeopleRepositorySuiteFactory(testpkg.NewDatabase(t, db))

	// Capture the EMITTER's broadcaster (distinct from the service's own): the
	// guardian fan-out rides BroadcastChildUpdateToGuardians on the emitter.
	emitterBC := testpkg.NewRecordingBroadcaster()
	emitter := api.NewParentEventEmitter(testpkg.MustDatabase(db), testpkg.TenantRuntime(t, db), reposMessages.ParentMessageThread, communicationtest.NewParentMessageRepository(db),
		parentSettingsStub{boolDefault: true}, emitterBC, slog.Default())
	settings := parentSettingsStub{
		boolValues: map[string]bool{
			parentportal.KeyParentPickupChangeEnabled: true,
			parentportal.KeyParentNotesEnabled:        true,
		},
	}
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
		MessagingEnabled:    owners.BindParentMessagingGate(settings, slog.Default()),
		CarePlan:            owners.NewParentCarePlanCommands(repos.CarePlan(), nil),
		People:              owners.MustNewPeopleDirectory(testpkg.MustDatabase(db)),
		CareProfiles:        careProfiles(t, db),
		ChildRepo:           repos.ParentChildReads(),
		StatusDayRepo:       repos.StudentStatusDay,
		StudentRepo:         owners.NewParentStudentReads(reposPeople.Student),
		CareExceptions:      owners.NewParentCareExceptions(repos.CarePlan()),
		Settings:            settings,
		StudentUpdates:      owners.BindParentStudentUpdates(testpkg.NewRecordingBroadcaster()),
		MessageThreadRepo:   owners.BindParentMessageThreadAccess(reposMessages.ParentMessageThread),
		MessageRepo:         owners.BindParentMessageReads(communicationtest.NewParentMessageRepository(db)),
		MessageReadRepo:     owners.BindParentMessageInboxReads(reposMessages.ParentMessageRead),
		Conversations:       api.NewParentConversationCore(reposMessages.ParentMessageThread, communicationtest.NewParentMessageRepository(db), reposMessages.ParentMessageRead, testpkg.NewRecordingBroadcaster(), slog.Default()),
		Emitter:             owners.BindParentChildEvents(emitter),
		Logger:              slog.Default(),
		Now:                 careFixtureNow,

		DataRequests: owners.NewParentDataRequestCommands(repos.CarePlan()),

		CarePlanPolicy: owners.NewParentCarePlanPolicy(),
	})

	chain := testpkg.CreateTestParentGuardianChain(t, db)

	date := careFixtureToday().AddDays(3)
	seedGuardianPickupException(t, db, chain, date, wallClock(15, 30))
	require.NoError(t, svc.DeleteCareException(testpkg.WithPackageTenantRuntime(context.Background()), chain.AccountID, chain.StudentID, date))

	msgs := loadThreadPills(t, db, reposMessages, chain)
	require.Len(t, msgs, 1)
	assert.Equal(t, "care_exception_correction", msgs[0].EventType)

	guardianCalls := emitterBC.CallsByMethod("guardian")
	require.NotEmpty(t, guardianCalls,
		"withdrawing a care exception must wake the child's guardians (#1725 review)")
	woke := false
	for _, c := range guardianCalls {
		if c.GuardianID == chain.AccountID {
			woke = true
			assert.Equal(t, realtime.EventParentChildUpdated, c.Event.Type,
				"the wake must carry a parent_child_updated invalidation")
			assert.Equal(t, chain.TenantID, c.TenantID)
		}
	}
	assert.True(t, woke,
		"the child's guardian account %d must be among the woken guardians", chain.AccountID)
}

// loadThreadPills reads the (student, guardian) thread messages under the tenant
// tx (RLS), returning an empty slice when no thread exists.
func loadThreadPills(t *testing.T, db *bun.DB, repos *api.ParentMessagingSuiteRepositories, c testpkg.ParentChain) []*parentportal.ParentMessage {
	t.Helper()
	var msgs []*parentportal.ParentMessage
	err := testpkg.WithTenantTx(t, testpkg.WithPackageTenantRuntime(context.Background()), db, c.TenantID, func(txCtx context.Context, _ bun.Tx) error {
		th, ferr := repos.ParentMessageThread.FindByStudentGuardian(txCtx, c.StudentID, c.AccountID, "team")
		if ferr != nil || th == nil {
			return ferr
		}
		ms, merr := api.ParentConversationMessagesFixture(txCtx, communicationtest.NewParentMessageRepository(db), th.ID, 100)
		msgs = ms
		return merr
	})
	require.NoError(t, err)
	return msgs
}
