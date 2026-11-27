package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestFixedTermStartsWithTheFirstConcludedVersion(t *testing.T) {
	t.Parallel()
	f := newRaceFixture(t, "Träger Laufzeit nach neuer Erstfassung")
	store := postgres.NewStore(calendar.TodayDate)
	september := calendar.NewDate(2027, 9, 1)
	_, err := f.db.ExecContext(context.Background(), `UPDATE care_contract.contract_versions
		SET term_kind = 'fixed_months', term_months = 12, ends_on = DATE '2028-07-31' WHERE contract_id = ?`, f.contract)
	require.NoError(t, err)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(ctx context.Context) error {
		record, err := store.Contract(ctx, f.org, f.contract, true)
		if err != nil {
			return err
		}
		version := record.Version
		version.Number, version.EffectiveFrom = 2, september
		version.EndsOn = date(2028, 8, 31)
		_, err = store.InsertVersion(ctx, f.org, f.contract,
			ports.VersionStep{Overtake: version.ID.Int64(), Status: carecontract.VersionRequested}, version)
		if err != nil {
			return err
		}
		return f.conclude(ctx)
	}))
	// Exercise the same history through the imported enrollment reader too.
	_, err = f.db.ExecContext(context.Background(), `UPDATE care_contract.contracts SET import_origin = 'first-concluded' WHERE id = ?`, f.contract)
	require.NoError(t, err)
	require.NoError(t, testpkg.WithinTraeger(f.ctx, f.org, func(ctx context.Context) error {
		contracts, err := store.AmendableContracts(ctx, f.org)
		require.NoError(t, err)
		require.Len(t, contracts, 1)
		contract := contracts[0]
		assert.Equal(t, september, contract.FirstFrom)
		application := carecontract.Application{Bookings: []carecontract.Booking{
			{CareOfferingID: 7, Days: []string{"mon"}, ValidFrom: &september, ValidUntil: date(2027, 10, 1)},
			{CareOfferingID: 7, Days: []string{"mon", "tue"}, ValidFrom: date(2027, 10, 1)},
		}}
		read := schoolRead{offerings: map[int64]carecontract.Offering{7: {ID: 7, Name: "Ganztag", EndTimes: map[string]string{"mon": "16:00", "tue": "16:00"}}}}
		plan, reason := nextAmendment(read, application, contract, calendar.NewDate(2027, 9, 1))
		require.Empty(t, reason)
		require.NotNil(t, plan)
		assert.Equal(t, date(2028, 8, 31), plan.version.EndsOn, "a later amendment preserves the twelve-month term")
		enrolled, err := store.EnrollmentContracts(ctx, f.org, contract.Key.SchoolID, []int64{f.contract}, false)
		require.NoError(t, err)
		require.Len(t, enrolled, 1)
		assert.Equal(t, september, enrolled[0].FirstFrom)
		return nil
	}))
}
