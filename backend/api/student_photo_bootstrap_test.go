package api

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"

	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/stretchr/testify/require"
)

// The photo lifecycle the root builds answers the feature toggle the settings
// registry dispatches (#4007).
func TestStudentPhotosRegisterTheFeatureToggle(t *testing.T) {
	t.Parallel()

	photos := NewStudentPhotos(nil, StudentPhotoRuntimeDependencies{Logger: slog.Default()})
	registry, err := settingsCompose.NewSideEffects(func(string) {},
		settingsCompose.SettingSideEffect{Key: configModel.KeyStudentPhotosEnabled, Handle: photos.HandleFeatureToggle})
	require.NoError(t, err)
	post, err := registry.Dispatch(context.Background(), 1, "operations.student_photos_enabled", "x")
	require.NoError(t, err)
	require.NotNil(t, post)
}

func TestPhotoConsentActorExcludesOperatorAccounts(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	account := testpkg.CreateTestAccount(t, db, "photo-actor@example.test")
	trail := owners.NewTestAuditPersistence(testpkg.NewDatabase(t, db), nil).StudentConsentChange
	runtime := newStudentPhotoRuntime(StudentPhotoRuntimeDependencies{ActingAccount: actingAccountID})
	runtime.ConsentTrail = trail
	directory, err := peopleCompose.New(peopleCompose.Dependencies{
		DB: db, StudentDirectory: owners.StudentDirectoryReader(),
		Observe: func(peopleCompose.Observation) {}, StudentPhotos: runtime,
	}, nil)
	require.NoError(t, err)
	for _, scope := range []string{"platform", "school", "parent"} {
		t.Run(scope, func(t *testing.T) {
			// Use the same numeric ID in both namespaces to catch false attribution
			// even when the foreign key would accept an unrelated school account.
			ctx := context.WithValue(testpkg.Ctx(t), sessiontoken.CtxClaims, sessiontoken.AppClaims{ID: int(account.ID), Scope: scope})
			student := testpkg.CreateTestStudent(t, db, "Consent", scope, "1a")
			givenAt := time.Date(2026, time.November, 16, 9, 0, 0, 0, time.UTC)
			_, err := db.NewUpdate().TableExpr("users.student_profiles").
				Set("photo_consent_given_at = ?", givenAt).Where("id = ?", student.ID).Exec(ctx)
			require.NoError(t, err)
			_, err = directory.PurgeStudentPhotos(ctx)
			require.NoError(t, err)
			entries, err := testpkg.TenantQuery1(t, ctx, db, trail.ListByStudentID, student.ID)
			require.NoError(t, err)
			require.Len(t, entries, 1)
			if scope == "platform" {
				require.Nil(t, entries[0].ActorAccountID, "operator IDs do not reference auth.accounts")
			} else {
				require.Equal(t, &account.ID, entries[0].ActorAccountID)
			}
		})
	}
}
