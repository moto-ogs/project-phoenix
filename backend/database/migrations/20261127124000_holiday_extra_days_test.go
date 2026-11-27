package migrations

import (
	"testing"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestHolidayExtraDaysMigrationRollsBackAndReapplies(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	org := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Zusatztag", Slug: "traeger-zusatztag", Active: true})
	var periodID int64
	require.NoError(t, db.NewRaw(`INSERT INTO enrollment.holiday_periods
  (organization_id, name, registration_opens_on, registration_closes_on)
  VALUES (?, 'Herbstferien', '2026-09-01', '2026-09-30') RETURNING id`, org.ID).Scan(ctx, &periodID))

	require.NoError(t, holidayExtraDaysDown(ctx, db))
	require.NoError(t, holidayExtraDaysUp(ctx, db))

	var kind string
	var included bool
	require.NoError(t, db.NewRaw(`SELECT kind, included_in_fee FROM enrollment.holiday_periods WHERE id = ?`, periodID).Scan(ctx, &kind, &included))
	require.Equal(t, "holiday", kind, "existing periods stay holiday periods")
	require.False(t, included)
	_, err := db.ExecContext(ctx, `UPDATE enrollment.holiday_periods SET included_in_fee = true WHERE id = ?`, periodID)
	require.ErrorContains(t, err, "chk_holiday_periods_included_in_fee", "only an extra day is included in the monthly contribution")
	_, err = db.ExecContext(ctx, `UPDATE enrollment.holiday_periods SET kind = 'trip' WHERE id = ?`, periodID)
	require.ErrorContains(t, err, "chk_holiday_periods_kind")
	_, err = db.ExecContext(ctx, `UPDATE enrollment.holiday_periods SET kind = 'extra_day', included_in_fee = true WHERE id = ?`, periodID)
	require.NoError(t, err)
}
