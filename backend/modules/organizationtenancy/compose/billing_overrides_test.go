package compose

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBillingCaptureUsesTheOwnKeyDayOfASchoolAndItsTraeger pins the levels of
// #7301: a school's own day wins over its Träger's, the Träger's over the day
// of every school, each school is captured once per month on its own key
// date, and a reset hands the school back to the next level.
func TestBillingCaptureUsesTheOwnKeyDayOfASchoolAndItsTraeger(t *testing.T) {
	t.Parallel()
	counts := &stubBillingCounts{}
	now := berlinTime(2099, time.October, 1, 12, 0)
	db := testpkg.SetupIsolatedTestDB(t)
	billing, err := NewBilling(BillingDependencies{Counts: counts, Now: func() time.Time { return now }})
	require.NoError(t, err)
	ctx := adminCtx(t, db)
	operator := testpkg.UniqueTestTenantID(t)

	nord := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Nord", Slug: fmt.Sprintf("nord-%d", operator), Active: true})
	bach := testpkg.CreateTestSchoolInOrganization(t, db, nord.ID, "OGS Am Bach")
	linden := testpkg.CreateTestSchoolInOrganization(t, db, nord.ID, "OGS Lindenweg")
	other, _ := testpkg.CreateTestTenant(t, db)
	counts.students = map[int64]int{bach: 11, linden: 22, other: 33}

	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Day: new(15)}, operator)
	require.NoError(t, err)
	five, twenty := 5, 20
	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: nord.ID}, Day: &five}, operator)
	require.NoError(t, err)
	keyDay, err := billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: linden, School: true}, Day: &twenty}, operator)
	require.NoError(t, err)
	assert.Equal(t, 15, keyDay.Day, "the standard stays")
	overrides := keyDay.Overrides
	require.Len(t, overrides, 2)
	assert.Equal(t, "Träger Nord", overrides[0].Name, "the Träger before its schools")
	assert.Equal(t, 5, overrides[0].Day)
	assert.Equal(t, "2099-10-05", overrides[0].NextKeyDate)
	require.NotNil(t, overrides[1].SchoolID)
	assert.Equal(t, linden, *overrides[1].SchoolID)
	assert.Equal(t, "Träger Nord", overrides[1].OrganizationName)
	assert.Equal(t, nord.ID, overrides[1].TraegerID, "a school names its Träger by ID")
	assert.Equal(t, nord.ID, overrides[0].TraegerID)
	assert.Equal(t, 20, overrides[1].Day)

	// The key day with its overrides is two reads, flat in the number of
	// overrides (#2940).
	counter := testpkg.CaptureQueries(t, db)
	counter.Reset()
	read, err := billing.BillingKeyDay(ctx)
	require.NoError(t, err)
	require.Len(t, read.Overrides, 2)
	querybudgets.AssertQueryBudget(t, "modules.organizationtenancy.billing.key_day", counter.Measurement(withoutTransactionControl(counter.Queries())))

	keyDates := func() map[int64]string {
		rows, err := billing.ListBillingKeyDateCounts(ctx)
		require.NoError(t, err)
		result := map[int64]string{}
		for _, row := range rows {
			// The clone's bootstrap school follows the day of every school;
			// only the three schools of this test are compared.
			if row.Period == "2099-10-01" && (row.SchoolID == bach || row.SchoolID == linden || row.SchoolID == other) {
				result[row.SchoolID] = row.KeyDate
			}
		}
		return result
	}
	for _, step := range []struct {
		at   time.Time
		want map[int64]string
	}{
		{berlinTime(2099, time.October, 5, 6, 0), map[int64]string{bach: "2099-10-05"}},
		{berlinTime(2099, time.October, 15, 6, 0), map[int64]string{bach: "2099-10-05", other: "2099-10-15"}},
		{berlinTime(2099, time.October, 20, 6, 0), map[int64]string{bach: "2099-10-05", other: "2099-10-15", linden: "2099-10-20"}},
	} {
		_, err := billing.RecordDueBillingKeyDates(ctx, step.at)
		require.NoError(t, err)
		got := keyDates()
		for school, keyDate := range step.want {
			assert.Equal(t, keyDate, got[school], "school %d at %s", school, step.at)
		}
		assert.Len(t, got, len(step.want), "no school is captured before its own key date (%s)", step.at)
	}

	// The school goes back to its Träger's day; only the Träger stays listed.
	now = berlinTime(2099, time.October, 25, 12, 0)
	keyDay, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: linden, School: true}, Day: nil}, operator)
	require.NoError(t, err)
	require.Len(t, keyDay.Overrides, 1)
	assert.Equal(t, "2099-11-05", keyDay.Overrides[0].NextKeyDate)
	_, err = billing.RecordDueBillingKeyDates(ctx, berlinTime(2099, time.November, 5, 6, 0))
	require.NoError(t, err)
	rows, err := billing.ListBillingKeyDateCounts(ctx)
	require.NoError(t, err)
	assert.Equal(t, "2099-11-05", countOf(t, rows, linden, "2099-11-01").KeyDate, "the reset school follows its Träger again")
	assert.Equal(t, 22, countOf(t, rows, linden, "2099-11-01").ActiveStudents)
}

// TestBillingKeyDayOverrideChangesOnlyWhatChanged pins the guards of the
// write: an unknown or deleted Träger or school is refused, a day equal to
// the stored one keeps the time of the last change, so the capture of the
// month is not skipped as if the day had moved.
func TestBillingKeyDayOverrideChangesOnlyWhatChanged(t *testing.T) {
	t.Parallel()
	counts := &stubBillingCounts{}
	now := berlinTime(2099, time.March, 1, 12, 0)
	db := testpkg.SetupIsolatedTestDB(t)
	billing, err := NewBilling(BillingDependencies{Counts: counts, Now: func() time.Time { return now }})
	require.NoError(t, err)
	ctx := adminCtx(t, db)
	operator := testpkg.UniqueTestTenantID(t)
	school, _ := testpkg.CreateTestTenant(t, db)
	deleted, _ := testpkg.CreateTestTenant(t, db)
	_, err = db.ExecContext(context.Background(), "UPDATE platform.schools SET deleted_at = NOW() WHERE id = ?", deleted)
	require.NoError(t, err)

	ten, thirty := 10, 30
	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: deleted, School: true}, Day: &ten}, operator)
	require.ErrorIs(t, err, organizationtenancy.ErrSchoolNotFound)
	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: deleted, School: true}, Day: nil}, operator)
	require.ErrorIs(t, err, organizationtenancy.ErrSchoolNotFound, "a reset is refused too")
	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: -1}, Day: &ten}, operator)
	require.ErrorIs(t, err, organizationtenancy.ErrOrganizationNotFound)
	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: school, School: true}, Day: &thirty}, operator)
	require.ErrorIs(t, err, organizationtenancy.ErrInvalidBillingKeyDay)

	_, err = billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: school, School: true}, Day: &ten}, operator)
	require.NoError(t, err)
	// Saved again after the key date: no change, so March is still captured.
	now = berlinTime(2099, time.March, 12, 12, 0)
	keyDay, err := billing.SetBillingKeyDay(ctx, organizationtenancy.BillingKeyDayChange{Target: &organizationtenancy.BillingKeyDayTarget{ID: school, School: true}, Day: &ten}, operator)
	require.NoError(t, err)
	require.Len(t, keyDay.Overrides, 1)
	assert.Equal(t, berlinTime(2099, time.March, 1, 12, 0), keyDay.Overrides[0].UpdatedAt.In(now.Location()))

	written, err := billing.RecordDueBillingKeyDates(ctx, berlinTime(2099, time.March, 12, 13, 0))
	require.NoError(t, err)
	assert.Positive(t, written)
	rows, err := billing.ListBillingKeyDateCounts(ctx)
	require.NoError(t, err)
	assert.Equal(t, "2099-03-10", countOf(t, rows, school, "2099-03-01").KeyDate)
	for _, row := range rows {
		assert.NotEqual(t, deleted, row.SchoolID, "a deleted school is never captured")
	}
}
