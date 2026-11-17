package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/enrollment/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// ownerClockInstant lies years before the database clock: a decision that
// still compared with NOW() would see the owner's stamps as future rows.
var ownerClockInstant = calendar.NewDate(2020, time.March, 2).BerlinMidnight().Add(10 * time.Hour)

// The retention of settled enrollments and of their uploads compares the
// children's status stamp with cutoffs of the owner clock (ADR 0281). The
// withdrawal of the rollover deadline only moves updated_at, so that stamp
// must come from the same clock: with NOW() the withdrawn request of 2020
// stays, because PostgreSQL stamped it in the present.
func TestSettledRequestRetentionReadsTheOwnerClockStamp(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	requestID := familyChildrenRequest(t, db, school, "settled@example.org")
	var phaseID int64
	require.NoError(t, db.NewRaw(`SELECT phase_id FROM enrollment.requests WHERE id = ?`, requestID).Scan(context.Background(), &phaseID))
	_, err := db.NewRaw(`INSERT INTO enrollment.request_children (tenant_id, request_id, first_name, last_name, date_of_birth, status)
		VALUES (?, ?, 'Mia', 'Muster', DATE '2016-04-01', ?)`, school, requestID, enrollment.ChildStatusSubmitted).Exec(context.Background())
	require.NoError(t, err)
	store := postgres.NewStore(postgres.NewDatabase(), func(ctx context.Context) (int64, error) { return tenant.FromContext(ctx), nil }).
		WithClock(func() time.Time { return ownerClockInstant })
	cutoff := ownerClockInstant.Add(24 * time.Hour)

	err = testpkg.WithinTenantContext(t, context.Background(), db, school, func(ctx context.Context) error {
		moved, err := store.TransitionPhaseChildren(ctx, phaseID, enrollment.ChildStatusSubmitted, enrollment.ChildStatusWithdrawn)
		require.NoError(t, err)
		require.Equal(t, 1, moved)
		upload := &enrollment.RequestUpload{PhaseID: phaseID, FieldKey: "nachweis", Filename: "nachweis.pdf", StoredName: "nachweis-settled.pdf", SizeBytes: 3, ContentType: "application/pdf", TokenHash: "settled"}
		require.NoError(t, store.InsertRequestUpload(ctx, upload))
		require.NoError(t, store.ClaimRequestUploads(ctx, []int64{upload.ID}, requestID, ownerClockInstant))

		settled, err := store.SettledRequestsBefore(ctx, cutoff, cutoff, calendar.DateFromTime(cutoff))
		require.NoError(t, err)
		assert.Equal(t, []int64{requestID}, settled, "the withdrawal of 2020 is settled a day later on the owner clock")
		deleted, err := store.DeleteExpiredRequestUploads(ctx, ownerClockInstant.Add(-time.Hour), cutoff)
		require.NoError(t, err)
		assert.Equal(t, 1, deleted, "the upload of the decided request goes with the cutoff of the owner clock")
		return nil
	})
	require.NoError(t, err)
}

// The submission window opens, runs and expires on the owner clock: two
// hours after the first attempt a one-hour window starts afresh, and the
// nightly cleanup removes the bucket a day later. With NOW() both stamps
// lay in the present of the database and neither happened.
func TestSubmissionRateLimitWindowRunsOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db, _, school := setupRateLimitTest(t)
	now := ownerClockInstant
	owner := enrollmentCompose.NewClocked(func() time.Time { return now })
	key := uniqueKeyValue("owner-clock")
	increment := func() int {
		state, err := repoIncrement(t, db, owner, school, enrollment.SubmissionRateLimitKeyTypeIP, key, time.Hour)
		require.NoError(t, err)
		return state.Attempts
	}

	require.Equal(t, 1, increment())
	now = ownerClockInstant.Add(30 * time.Minute)
	require.Equal(t, 2, increment(), "inside the window the attempts add up")
	now = ownerClockInstant.Add(2 * time.Hour)
	assert.Equal(t, 1, increment(), "after the window a new one starts")

	now = ownerClockInstant.Add(27 * time.Hour)
	var deleted int
	require.NoError(t, runInSchool(t, db, school, func(ctx context.Context) error {
		var err error
		deleted, _, err = owner.DeleteExpiredSubmissionRateLimits(ctx)
		return err
	}))
	assert.Equal(t, 1, deleted, "a day after its window started the bucket goes")
}
