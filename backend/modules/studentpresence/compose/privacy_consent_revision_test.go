package compose_test

import (
	"context"
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestConsentRevisionPreservesDetailsAndRollsBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	student := testpkg.CreateTestStudent(t, db, "Consent", "Revision", "3a")
	var consent studentpresence.PrivacyConsent
	err = tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		consent, err = module.RecordPrivacyConsent(txCtx, studentpresence.PrivacyConsent{
			StudentID: student.ID, PolicyVersion: "1.0", Accepted: true, DataRetentionDays: 7, Details: []byte(`{"source":"original"}`),
		})
		return err
	})
	require.NoError(t, err)
	require.JSONEq(t, `{"source":"original"}`, string(consent.Details))
	created := consent.CreatedAt
	read, err := module.ListPrivacyConsents(ctx, student.ID)
	require.NoError(t, err)
	revision := studentpresence.PrivacyConsentRevision{
		StudentID: student.ID, ExpectedVersion: studentpresence.PrivacyConsentVersion(read), PolicyVersion: "1.0",
		Accepted: true, DataRetentionDays: 14, Details: []byte(`{"source":"revised"}`),
	}
	failure := errors.New("abort consent revision")
	err = tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		revised, err := module.RevisePrivacyConsent(txCtx, revision)
		require.NoError(t, err)
		require.Equal(t, consent.ID, revised.Consent.ID)
		require.Equal(t, created, revised.Consent.CreatedAt)
		require.JSONEq(t, `{"source":"revised"}`, string(revised.Consent.Details))
		return failure
	})
	require.ErrorIs(t, err, failure)
	rows, err := module.ListPrivacyConsents(ctx, student.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, 7, rows[0].DataRetentionDays)
	require.JSONEq(t, `{"source":"original"}`, string(rows[0].Details))
	require.NoError(t, tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		_, err := module.RevisePrivacyConsent(txCtx, revision)
		return err
	}))
	rows, err = module.ListPrivacyConsents(ctx, student.ID)
	require.NoError(t, err)
	require.Equal(t, 14, rows[0].DataRetentionDays)
	require.JSONEq(t, `{"source":"revised"}`, string(rows[0].Details))
	_, err = module.RevisePrivacyConsent(context.Background(), revision)
	require.Error(t, err)
	foreignID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, foreignID)
	// The foreign tenant sees no consent of this child, so it sends the
	// version of that empty read: the token passes, isolation must refuse.
	revision.ExpectedVersion = studentpresence.PrivacyConsentVersion(nil)
	err = testpkg.WithinTenantContext(t, context.Background(), db, foreignID, func(txCtx context.Context) error {
		_, err := module.RevisePrivacyConsent(txCtx, revision)
		return err
	})
	require.Error(t, err, "another tenant cannot revise this consent")
	require.NotErrorIs(t, err, readstate.ErrChanged, "refused by isolation, not by the token")
	rows, err = module.ListPrivacyConsents(ctx, student.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, 14, rows[0].DataRetentionDays)
}
