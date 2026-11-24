package contracttest_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// Two staff members edit one offering from the same read: the second save
// is refused and writes nothing, and the stored offering keeps the first
// save (ADR 0311). No updated_at trigger stamps every writer, so the token
// is a fingerprint of the stored values.
func TestCareOfferingSaveRefusesAnotherReadVersion(t *testing.T) {
	t.Parallel()
	_, rows, phase := setupCareTest(t)
	ctx := testpkg.Ctx(t)
	created, err := rows.Create(ctx, &offeringContract.CareOfferingRecord{
		PhaseID: phase.ID, Name: "Frühbetreuung", DaysOfWeekMode: offeringContract.DaysOfWeekModeFixed,
		AvailableDays: []string{"mon"}, PickupTimes: carePickupTimes("mon"), IsActive: true,
	})
	require.NoError(t, err)

	first, err := rows.GetByID(ctx, created.ID)
	require.NoError(t, err)
	second, err := rows.GetByID(ctx, created.ID)
	require.NoError(t, err)
	require.NotEmpty(t, first.Version)
	require.Equal(t, first.Version, second.Version)

	capacity := 12
	second.Capacity = &capacity
	require.NoError(t, rows.UpdateRead(ctx, second, second.Version), "the save over the read version goes through")

	first.Name = "Frühbetreuung ab 7 Uhr"
	err = rows.UpdateRead(ctx, first, first.Version)
	require.ErrorIs(t, err, readstate.ErrChanged, "the save over an older read is refused")
	err = rows.UpdateRead(ctx, first, "")
	require.ErrorIs(t, err, readstate.ErrChanged, "a save without a read is refused")

	stored, err := rows.GetByID(ctx, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "Frühbetreuung", stored.Name, "the refused save wrote nothing")
	require.NotNil(t, stored.Capacity)
	assert.Equal(t, 12, *stored.Capacity, "the first save stays")
	assert.NotEqual(t, first.Version, stored.Version)

	stored.Name = "Frühbetreuung ab 7 Uhr"
	require.NoError(t, rows.UpdateRead(ctx, stored, stored.Version), "a save over the stored state goes through")
}
