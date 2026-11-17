package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/enrollment/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The holiday decisions of this file run in March 2020 on the owner clock
// while the database clock stands in the present (ADR 0281): a window that
// still read NOW() would count every 2020 stamp as fresh.

// holidayClockAt returns a store clock that reads *at.
func holidayClockAt(at *time.Time) func() time.Time { return func() time.Time { return *at } }

func holidayAdmin(t *testing.T, db *bun.DB, fn func(ctx context.Context) error) {
	t.Helper()
	require.NoError(t, tenant.WithinAdmin(tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, db)), fn))
}

// The public registration's limits count in windows of the owner clock: two
// hours after the first attempt a new one-hour window begins, and the
// counters go a day after their window on that clock, in the Träger's own
// cleanup and in the hourly retention across Träger.
func TestHolidayRegistrationRateLimitWindowRunsOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	w := newPlacesWeek(t, db, "Träger Sperre Uhr")
	at := ownerClockInstant
	store := postgres.NewHolidayRegistrationStore().WithClock(holidayClockAt(&at))
	count := func(ctx context.Context, key string) int {
		attempts, err := store.CountHolidayRegistrationAttempt(ctx, w.organization, "ip", key, time.Hour, 24*time.Hour)
		require.NoError(t, err)
		return attempts
	}
	buckets := func(key string) int {
		var rows int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM enrollment.holiday_registration_rate_limits
			WHERE organization_id = ? AND key_hash = encode(sha256(convert_to(?, 'UTF8')), 'hex')`, w.organization, key).Scan(context.Background(), &rows))
		return rows
	}

	withinTraeger(t, db, w.organization, func(ctx context.Context) {
		assert.Equal(t, 1, count(ctx, "192.0.2.1"))
		assert.Equal(t, 2, count(ctx, "192.0.2.1"), "the second attempt counts in the same window")
		assert.Equal(t, 1, count(ctx, "192.0.2.2"))
		at = ownerClockInstant.Add(2 * time.Hour)
		assert.Equal(t, 1, count(ctx, "192.0.2.1"), "two hours later a new window begins")
		at = ownerClockInstant.Add(26 * time.Hour)
		assert.Equal(t, 1, count(ctx, "192.0.2.3"))
	})
	assert.Zero(t, buckets("192.0.2.2"), "the Träger's cleanup drops a counter a day after its window")
	assert.Equal(t, 1, buckets("192.0.2.1"), "the counter of the later window stays")

	at = ownerClockInstant.Add(2*time.Hour + 25*time.Hour)
	holidayAdmin(t, db, func(ctx context.Context) error {
		_, _, err := store.DeleteExpiredHolidayRegistrations(ctx, calendar.DateFromTime(at), 0, 24*time.Hour)
		return err
	})
	assert.Zero(t, buckets("192.0.2.1"), "the hourly retention drops it a day after its window")
	assert.Equal(t, 1, buckets("192.0.2.3"), "and keeps the younger one")
}

// A proof of benefits claims within its lifetime on the owner clock that
// stamps it, and the hourly retention ages unclaimed proofs on that clock.
func TestHolidayProofLifetimeRunsOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	w := newPlacesWeek(t, db, "Träger Nachweis Uhr")
	at := ownerClockInstant
	store := postgres.NewHolidayRegistrationStore().WithClock(holidayClockAt(&at))
	proof := enrollment.HolidayProofUpload{Filename: "bescheid.pdf", ContentType: "application/pdf", SizeBytes: 3, Content: []byte("pdf")}
	claim := func(token string) int {
		var claimed int
		withinTraeger(t, db, w.organization, func(ctx context.Context) {
			var err error
			claimed, err = store.ClaimHolidayProofs(ctx, w.organization, w.period, w.waiting, []string{token})
			require.NoError(t, err)
		})
		return claimed
	}
	withinTraeger(t, db, w.organization, func(ctx context.Context) {
		require.NoError(t, store.InsertHolidayProof(ctx, w.organization, w.period, proof, "uhr-frisch"))
		require.NoError(t, store.InsertHolidayProof(ctx, w.organization, w.period, proof, "uhr-alt"))
	})

	at = ownerClockInstant.Add(time.Hour)
	assert.Equal(t, 1, claim("uhr-frisch"), "an hour-old proof is claimed")
	at = ownerClockInstant.Add(25 * time.Hour)
	assert.Zero(t, claim("uhr-alt"), "a day-old proof claims nothing")

	var deleted int
	holidayAdmin(t, db, func(ctx context.Context) error {
		var err error
		deleted, err = store.DeleteUnclaimedHolidayProofs(ctx, enrollment.UnclaimedUploadLifetime)
		return err
	})
	assert.Equal(t, 1, deleted, "the unclaimed day-old proof goes")
	var kept []string
	require.NoError(t, db.NewRaw(`SELECT COALESCE(token_hash, 'claimed') FROM enrollment.holiday_registration_proofs
		WHERE organization_id = ?`, w.organization).Scan(context.Background(), &kept))
	assert.Equal(t, []string{"claimed"}, kept)
}

// The places of a week go by submitted_at, which the owner clock stamps:
// the registration submitted earlier on that clock waits ahead, whatever
// order the database received them in.
func TestHolidayQueueOrdersBySubmissionOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	w := newPlacesWeek(t, db, "Träger Reihenfolge Uhr")
	var model int64
	require.NoError(t, db.NewRaw(`SELECT id FROM enrollment.holiday_week_time_models WHERE holiday_period_week_id = ?`, w.week).
		Scan(context.Background(), &model))
	at := ownerClockInstant
	store := postgres.NewHolidayRegistrationStore().WithClock(holidayClockAt(&at))
	register := func(ctx context.Context, email string, submitted time.Time) int64 {
		at = submitted
		receipt, err := store.InsertHolidayRegistration(ctx, w.organization, w.period, enrollment.HolidayRegistrationInput{
			Guardian:       enrollment.HolidayGuardianInput{FirstName: "Eva", LastName: "Uhr", Email: email, Phone: "0123"},
			PrivacyConsent: true, CustodyConfirmed: true, DeclarationName: "Eva Uhr", RetentionDays: 365, FormVersion: 1, ConsentVersion: enrollment.HolidayConsentVersionCurrent,
			Children: []enrollment.HolidayChildInput{{FirstName: "Kim", LastName: "Uhr", BirthDate: calendar.NewDate(2018, time.March, 4),
				Bookings: []enrollment.HolidayBookingInput{{WeekID: w.week, TimeModelID: model}}}},
		}, enrollment.HolidayPlacementWaitlisted, func(int64) (enrollment.HolidaySealedHealth, error) {
			return enrollment.HolidaySealedHealth{Children: make([][]byte, 1)}, nil
		})
		require.NoError(t, err)
		assert.True(t, receipt.SubmittedAt.Equal(submitted), "submitted_at is the owner clock's instant")
		return receipt.ID
	}

	withinTraeger(t, db, w.organization, func(ctx context.Context) {
		later := register(ctx, "spaeter@example.org", ownerClockInstant.Add(time.Hour))
		earlier := register(ctx, "frueher@example.org", ownerClockInstant)
		queue, found, err := store.ReadHolidayWeekQueue(ctx, w.organization, w.week)
		require.NoError(t, err)
		require.True(t, found)
		var order []int64
		for _, booking := range queue.Bookings {
			if booking.RegistrationID == later || booking.RegistrationID == earlier {
				order = append(order, booking.RegistrationID)
			}
		}
		assert.Equal(t, []int64{earlier, later}, order)
	})
}
