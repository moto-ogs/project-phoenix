package parentportal_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// On a day with changed opening hours the school closes earlier, and with it
// the parents' changes to today's pickup (#8157). Other days and other
// schools keep operations.session_end_time.
func TestPickupChangesCloseAtTheChangedClosingTime(t *testing.T) {
	t.Parallel()

	d := newCutoffServiceDeps(t)
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	settings := cutoffStub(true, "")
	settings.stringValues[parentService.KeySessionEndTime] = "16:00"
	// The production root binds the School Calendar the same way.
	d.base.ClosingTimes = api.OpeningChangeClosingTimes()
	service := func(hour, minute int) *parentService.Portal {
		return d.service(t, settings, berlinClock(hour, minute))
	}

	chain := testpkg.CreateTestParentGuardianChain(t, d.db)
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, d.db, chain.TenantID, func(txCtx context.Context) error {
		return api.CreateOpeningChangeFixture(txCtx, cutoffToday, "12:00")
	}))

	_, err := service(11, 59).SubmitPickupChangeRequest(ctx, chain.AccountID, chain.StudentID, cutoffToday, cutoffPickupTime(), "", "Arzttermin", nil)
	require.NoError(t, err, "before the changed closing time today stays open")

	_, err = service(12, 0).SubmitPickupChangeRequest(ctx, chain.AccountID, chain.StudentID, cutoffToday, cutoffPickupTime(), "", "Arzttermin", nil)
	require.ErrorIs(t, err, parentService.ErrPickupChangeCareDayEnded, "the changed closing time ends today's pickup changes")
	_, err = service(12, 0).SubmitPickupChangeRequest(ctx, chain.AccountID, chain.StudentID, cutoffToday.AddDays(1), cutoffPickupTime(), "", "Arzttermin", nil)
	require.NoError(t, err, "a later day keeps its regular hours")

	t.Run("andere Schule ohne geänderte Öffnungszeit", func(t *testing.T) {
		testpkg.OwnTenant(t)
		other := testpkg.CreateTestParentGuardianChain(t, d.db)
		require.NotEqual(t, chain.TenantID, other.TenantID)
		_, err := service(12, 0).SubmitPickupChangeRequest(ctx, other.AccountID, other.StudentID, cutoffToday, cutoffPickupTime(), "", "Arzttermin", nil)
		require.NoError(t, err, "the change of one school never closes another")
		_, err = service(16, 0).SubmitPickupChangeRequest(ctx, other.AccountID, other.StudentID, cutoffToday, cutoffPickupTime(), "", "Arzttermin", nil)
		require.ErrorIs(t, err, parentService.ErrPickupChangeCareDayEnded, "there operations.session_end_time still holds")
	})
}
