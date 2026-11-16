package compose

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/tenant/tenanttest"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// enabledPhotoRuntime is the smallest runtime the purge needs: the feature is
// on unless a test switches it off, and the consents the purge ended are kept.
type enabledPhotoRuntime struct {
	unlinked    []string
	switchedOff bool
	// staleOn is a request memo that still reads "on" after a switch-off
	// committed: only the in-transaction read sees switchedOff.
	staleOn       bool
	actor         int64
	endedConsents []int64
}

func (r *enabledPhotoRuntime) QueueUnlinkStoredPhoto(context.Context, string) error { return nil }

func (r *enabledPhotoRuntime) PhotoFeatureEnabled(_ context.Context, committed bool) (bool, error) {
	if committed {
		return !r.switchedOff, nil
	}
	return r.staleOn || !r.switchedOff, nil
}
func (r *enabledPhotoRuntime) ActingAccountID(context.Context) int64 { return r.actor }
func (r *enabledPhotoRuntime) UnlinkStoredPhoto(storedURL string) {
	r.unlinked = append(r.unlinked, storedURL)
}
func (r *enabledPhotoRuntime) BroadcastPhotoChange(int64, int64, string) {}
func (r *enabledPhotoRuntime) RecordPhotoConsent(
	context.Context, StudentPhotoConsentSnapshot, StudentPhotoConsentSnapshot, *int64, time.Time,
) error {
	return nil
}
func (r *enabledPhotoRuntime) RecordPhotoConsentsEnded(_ context.Context, studentIDs []int64, _ *int64, _ time.Time) error {
	r.endedConsents = append(r.endedConsents, studentIDs...)
	return nil
}

func buildPhotoModule(t *testing.T, db *bun.DB) (peopledirectory.Owner, *enabledPhotoRuntime) {
	t.Helper()
	runtime := &enabledPhotoRuntime{}
	module, err := New(Dependencies{
		StudentDirectory: testpkg.StudentDirectory{},
		DB:               db,
		Observe:          func(Observation) {},
		StudentPhotos:    runtime,
	}, nil)
	require.NoError(t, err)
	return module.Owner, runtime
}

func setStudentPhotoPath(t *testing.T, db *bun.DB, studentID int64, path *string) {
	t.Helper()
	_, err := db.NewUpdate().
		TableExpr("users.student_profiles").
		Set("photo_path = ?", path).
		Where("id = ?", studentID).
		Exec(testpkg.Ctx(t))
	require.NoError(t, err)
}

func studentPhotoPath(t *testing.T, db *bun.DB, studentID int64) *string {
	t.Helper()
	var row struct {
		PhotoPath *string `bun:"photo_path"`
	}
	require.NoError(t, db.NewSelect().
		TableExpr("users.student_profiles").
		Column("photo_path").
		Where("id = ?", studentID).
		Scan(testpkg.Ctx(t), &row))
	return row.PhotoPath
}

// TestPurgeStudentPhotosReturnsOldURLsAndClearsTheColumn pins the contract the
// feature-disable path depends on: the purge returns the OLD photo_path values
// (the files the post-commit unlink has to remove) and clears the column on the
// same rows in one statement.
//
// The single statement is what closes the race: a SELECT-then-UPDATE captures a
// snapshot and then clears rows that were not in it, leaving a concurrently
// uploaded file orphaned on disk. A plain UPDATE … RETURNING returns the
// post-update values, which are always NULL here — so this also asserts the
// join that surfaces the pre-image is in place.
func TestPurgeStudentPhotosReturnsOldURLsAndClearsTheColumn(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, _ := buildPhotoModule(t, db)
	ctx := testpkg.Ctx(t)

	first := testpkg.CreateTestStudent(t, db, "Purge", "One", "1a")
	second := testpkg.CreateTestStudent(t, db, "Purge", "Two", "1a")
	// Left NULL, so the purge is also shown not to touch rows without a photo.
	third := testpkg.CreateTestStudent(t, db, "Purge", "Three", "1a")

	firstURL := "/uploads/student-photos/p1.jpg"
	secondURL := "/uploads/student-photos/p2.jpg"
	setStudentPhotoPath(t, db, first.ID, &firstURL)
	setStudentPhotoPath(t, db, second.ID, &secondURL)

	urls, err := module.PurgeStudentPhotos(ctx)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{firstURL, secondURL}, urls,
		"the purge must return the photo paths as they were before the clear")

	assert.Nil(t, studentPhotoPath(t, db, first.ID))
	assert.Nil(t, studentPhotoPath(t, db, second.ID))
	assert.Nil(t, studentPhotoPath(t, db, third.ID))
}

func TestPurgeStudentPhotosWithoutStoredPhotos(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, _ := buildPhotoModule(t, db)

	testpkg.CreateTestStudent(t, db, "Empty", "Purge", "1a")

	urls, err := module.PurgeStudentPhotos(testpkg.Ctx(t))
	require.NoError(t, err)
	assert.Empty(t, urls, "no stored photo means no file to unlink and no error")
}

// TestLockStudentPhotoFeatureIsVisibleToOtherTransactions verifies the
// per-tenant advisory lock is really observable elsewhere. Without that
// serialization the in-transaction feature recheck on the upload path still
// races a concurrent disable: the upload commits a fresh photo_path AFTER the
// disable's purge captured its rows, and the file is orphaned because the
// disable's post-commit unlinks never saw it.
//
// The probe uses pg_try_advisory_xact_lock on a second connection, so a lock
// that silently no-oped fails the assertion instead of deadlocking the test.
func TestLockStudentPhotoFeatureIsVisibleToOtherTransactions(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, _ := buildPhotoModule(t, db)
	ctx := testpkg.Ctx(t)

	holding, err := db.BeginTx(ctx, nil)
	require.NoError(t, err, "begin the holding transaction")
	require.NoError(t, module.LockStudentPhotoFeature(tenanttest.WithTransaction(ctx, holding)),
		"the first transaction must acquire the per-tenant photo gate")

	// The advisory-lock class of the photo gate. Spelled out rather than
	// imported: the probe must fail if the owner ever changes the key silently.
	const lockClass int32 = 0x70686F74

	probe, err := db.BeginTx(ctx, nil)
	require.NoError(t, err, "begin the probing transaction")
	var acquired bool
	require.NoError(t, probe.NewRaw(`SELECT pg_try_advisory_xact_lock(?, ?)`,
		lockClass, int32(testpkg.Tenant(t))).Scan(ctx, &acquired))
	assert.False(t, acquired, "a second transaction must not take the gate while the first holds it")
	require.NoError(t, probe.Rollback())

	require.NoError(t, holding.Rollback(), "releasing the gate")

	after, err := db.BeginTx(ctx, nil)
	require.NoError(t, err, "begin the second probing transaction")
	defer func() { _ = after.Rollback() }()
	require.NoError(t, after.NewRaw(`SELECT pg_try_advisory_xact_lock(?, ?)`,
		lockClass, int32(testpkg.Tenant(t))).Scan(ctx, &acquired))
	assert.True(t, acquired, "the gate is bound to the tenant, not the connection, and is free again")
}

func (r *enabledPhotoRuntime) QueueUnlinkStoredPhotos(ctx context.Context, urls []string) error {
	for _, url := range urls {
		if err := r.QueueUnlinkStoredPhoto(ctx, url); err != nil {
			return err
		}
	}
	return nil
}

func setStudentPhotoConsent(t *testing.T, db *bun.DB, studentID int64, givenAt *time.Time) {
	t.Helper()
	_, err := db.NewUpdate().
		TableExpr("users.student_profiles").
		Set("photo_consent_given_at = ?", givenAt).
		Where("id = ?", studentID).
		Exec(testpkg.Ctx(t))
	require.NoError(t, err)
}

func studentPhotoConsent(t *testing.T, db *bun.DB, studentID int64) *time.Time {
	t.Helper()
	var row struct {
		GivenAt *time.Time `bun:"photo_consent_given_at"`
	}
	require.NoError(t, db.NewSelect().
		TableExpr("users.student_profiles").
		Column("photo_consent_given_at").
		Where("id = ?", studentID).
		Scan(testpkg.Ctx(t), &row))
	return row.GivenAt
}

// TestPhotoConsentDoesNotSurviveSwitchingTheFeatureOffAndOn is the regression
// of #7208: switching child photos off ends every photo consent with the
// photos, so after switching it on again an upload needs a new confirmation.
// A child whose consent stood without a photo loses it too, and both ended
// consents reach the trail; a child without either is left out.
func TestPhotoConsentDoesNotSurviveSwitchingTheFeatureOffAndOn(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, runtime := buildPhotoModule(t, db)
	ctx := testpkg.Ctx(t)
	runtime.actor = testpkg.CreateTestAccount(t, db, "photo-consent-7208@example.test").ID

	withPhoto := testpkg.CreateTestStudent(t, db, "Consent", "Photo", "1a")
	consentOnly := testpkg.CreateTestStudent(t, db, "Consent", "Only", "1a")
	neither := testpkg.CreateTestStudent(t, db, "Consent", "None", "1a")
	givenAt := time.Date(2026, time.September, 1, 9, 0, 0, 0, time.UTC)
	oldURL := "/uploads/student-photos/before-off.jpg"
	setStudentPhotoPath(t, db, withPhoto.ID, &oldURL)
	setStudentPhotoConsent(t, db, withPhoto.ID, &givenAt)
	setStudentPhotoConsent(t, db, consentOnly.ID, &givenAt)

	// Off: the setting's purge.
	runtime.switchedOff = true
	urls, err := module.PurgeStudentPhotos(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{oldURL}, urls)
	assert.Nil(t, studentPhotoConsent(t, db, withPhoto.ID), "the consent ends with the photo")
	assert.Nil(t, studentPhotoConsent(t, db, consentOnly.ID), "a consent without a photo ends as well")
	assert.ElementsMatch(t, []int64{withPhoto.ID, consentOnly.ID}, runtime.endedConsents,
		"every ended consent is recorded as withdrawn, the child without one is not")

	// On again: the upload asks for a new confirmation.
	runtime.switchedOff = false
	newURL := "/uploads/student-photos/after-on.jpg"
	err = module.CommitStudentPhoto(ctx, withPhoto.ID, newURL, false)
	require.ErrorIs(t, err, peopledirectory.ErrPhotoConsentRequired)
	assert.Nil(t, studentPhotoPath(t, db, withPhoto.ID))

	require.NoError(t, module.CommitStudentPhoto(ctx, withPhoto.ID, newURL, true))
	assert.Equal(t, &newURL, studentPhotoPath(t, db, withPhoto.ID))
	assert.NotNil(t, studentPhotoConsent(t, db, withPhoto.ID), "the confirmation records a new consent")
	assert.Nil(t, studentPhotoConsent(t, db, neither.ID))
}

// TestApplyStudentPhotoConsentGrantsOnlyWhileTheFeatureIsOn pins the gate of
// #7208: a new consent needs the feature on, a repeated grant changes nothing
// and a withdrawal stays possible while it is off.
func TestApplyStudentPhotoConsentGrantsOnlyWhileTheFeatureIsOn(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, runtime := buildPhotoModule(t, db)
	ctx := testpkg.Ctx(t)
	grant, withdraw := true, false
	givenAt := time.Date(2026, time.September, 1, 9, 0, 0, 0, time.UTC)
	withoutConsent := peopledirectory.StudentPhotoState{StudentID: 1}
	withConsent := peopledirectory.StudentPhotoState{StudentID: 1, PhotoConsentGivenAt: &givenAt}

	runtime.switchedOff = true
	_, err := module.ApplyStudentPhotoConsent(ctx, withoutConsent, &grant)
	require.ErrorIs(t, err, peopledirectory.ErrPhotoFeatureDisabled, "no new consent while photos are off")

	kept, err := module.ApplyStudentPhotoConsent(ctx, withConsent, &grant)
	require.NoError(t, err, "a repeated grant is no new consent")
	assert.Equal(t, &givenAt, kept.PhotoConsentGivenAt)

	withdrawn, err := module.ApplyStudentPhotoConsent(ctx, withConsent, &withdraw)
	require.NoError(t, err, "a withdrawal stays possible while photos are off")
	assert.Nil(t, withdrawn.PhotoConsentGivenAt)

	runtime.switchedOff = false
	granted, err := module.ApplyStudentPhotoConsent(ctx, withoutConsent, &grant)
	require.NoError(t, err)
	assert.NotNil(t, granted.PhotoConsentGivenAt)
}

// TestPhotoWritesUnderTheLockReadTheCommittedSwitch pins the freshness of
// the checks under the photo lock (#7208): a request that read "on" before a
// switch-off committed must not grant a consent or attach a photo after it.
// The stale memo is the request-scoped settings cache.
func TestPhotoWritesUnderTheLockReadTheCommittedSwitch(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, runtime := buildPhotoModule(t, db)
	ctx := testpkg.Ctx(t)
	runtime.actor = testpkg.CreateTestAccount(t, db, "photo-stale-7208@example.test").ID
	student := testpkg.CreateTestStudent(t, db, "Stale", "Switch", "1a")
	runtime.switchedOff, runtime.staleOn = true, true

	err := module.CommitStudentPhoto(ctx, student.ID, "/uploads/student-photos/stale.jpg", true)
	require.ErrorIs(t, err, peopledirectory.ErrPhotoFeatureDisabledMid, "the upload")
	assert.Nil(t, studentPhotoPath(t, db, student.ID))

	grantedAt := time.Date(2026, time.September, 1, 9, 0, 0, 0, time.UTC)
	err = module.SetStudentPhotoConsent(ctx, peopledirectory.StudentPhotoState{
		StudentID: student.ID, PhotoConsentGivenAt: &grantedAt, PhotoConsentGivenBy: &runtime.actor,
	})
	require.ErrorIs(t, err, peopledirectory.ErrPhotoFeatureDisabledMid, "the parents' grant")

	grant := true
	_, err = module.ApplyStudentPhotoConsent(ctx, peopledirectory.StudentPhotoState{StudentID: student.ID}, &grant)
	require.ErrorIs(t, err, peopledirectory.ErrPhotoFeatureDisabled, "the staff grant")
	assert.Nil(t, studentPhotoConsent(t, db, student.ID))
}
