package contracttest_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	enrollmentTest "github.com/moto-ogs/project-phoenix/modules/enrollment/enrollmenttest"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// readOfferingsVersion is the offerings_version the request detail answers
// for the child, as the correction editor sends it back (ADR 0311); a failed
// read sends none, so the correction is refused.
func readOfferingsVersion(ctx context.Context, decisions enrollmentTest.PublicDecisions, requestID, childID int64) string {
	sets, err := decisions.ListChildOfferings(ctx, requestID)
	if err != nil {
		return ""
	}
	return sets[childID].Version
}

// Two office members correct one child's bookings from the same read: the
// second correction is refused under the student lock and writes nothing,
// the first one stays (ADR 0311).
func TestChildOfferingCorrectionRefusesAnotherReadVersion(t *testing.T) {
	t.Parallel()
	f := newCompleteWithdrawalFixture(t)
	// read answers the child's offerings_version and current bookings as
	// the request detail shows them.
	read := func() (string, map[int64][]string) {
		sets, err := testpkg.TenantQuery1(t, f.ctx, f.env.db, f.env.decision.ListChildOfferings, f.requestID)
		require.NoError(t, err)
		booked := map[int64][]string{}
		for _, row := range sets[f.childID].Current {
			booked[row.OfferingID] = row.SelectedDays
		}
		return sets[f.childID].Version, booked
	}
	correct := func(version string, offerings []enrollmentTest.OfferingAdjustmentSelection) error {
		input := f.baseInput
		input.Offerings, input.ExpectedVersion = offerings, version
		return testpkg.WithTenantTx(t, f.ctx, f.env.db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
			_, err := f.env.decision.UpdateChildOfferings(ctx, input)
			return err
		})
	}
	before, _ := read()
	require.NotEmpty(t, before)
	withLunch := append(withdrawalSelection(f.careID), withdrawalSelection(f.lunchID)...)
	require.NoError(t, correct(before, withLunch), "the correction over the read bookings goes through")

	tuesday := []enrollmentTest.OfferingAdjustmentSelection{{OfferingID: f.careID, SelectedDays: []string{"tue"}}}
	require.ErrorIs(t, correct(before, tuesday), readstate.ErrChanged, "a correction over an older read is refused")
	require.ErrorIs(t, correct("", tuesday), readstate.ErrChanged, "a correction without a read is refused")

	stored, booked := read()
	assert.NotEqual(t, before, stored)
	assert.Equal(t, map[int64][]string{f.careID: {"mon"}, f.lunchID: {"mon"}}, booked, "the refused correction wrote nothing")
	require.NoError(t, correct(stored, tuesday), "a correction over the stored bookings goes through")
}
