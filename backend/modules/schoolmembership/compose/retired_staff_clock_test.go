package compose

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The retirement stamps deleted_at on the owner's clock, and the automatic
// deletion of staff compares it with a cutoff of that clock (#7295): with
// the owner clock years before the database clock, a member retired the day
// before the cutoff is due, and the erasure stamps the same clock.
func TestRetiredStaffErasureComparesTheRetirementOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	retiredAt := time.Date(2021, time.March, 1, 12, 0, 0, 0, calendar.Berlin)
	dependencies := Dependencies{DB: db, Observe: func(Observation) {}, Employment: testEmployment, ChildQuota: newChildQuotas(),
		Now: func() time.Time { return retiredAt }}
	module, err := New(dependencies)
	require.NoError(t, err)
	offboarding, err := NewOffboarding(dependencies)
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)
	retired := createStaff(t, ctx, db, module, "Clock", "Retired", schoolmembership.StaffFields{})
	require.NoError(t, module.DeleteStaff(ctx, retired.ID))

	cutoff := calendar.NewDate(2021, time.March, 2).BerlinMidnight()
	err = testpkg.WithinTenantContext(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context) error {
		erased, found, err := offboarding.EraseNextRetiredStaff(ctx, cutoff, 0)
		assert.True(t, found, "the member retired on the owner clock before the cutoff is due")
		assert.Equal(t, retired.ID, erased.StaffID)
		return err
	})
	require.NoError(t, err)

	var stamps struct {
		DeletedAt time.Time `bun:"deleted_at"`
		ErasedAt  time.Time `bun:"personal_data_erased_at"`
	}
	require.NoError(t, db.NewRaw(`SELECT deleted_at, personal_data_erased_at FROM users.staff_school_memberships WHERE id = ?`,
		retired.ID).Scan(ctx, &stamps))
	assert.True(t, stamps.DeletedAt.Equal(retiredAt), "deleted_at %s", stamps.DeletedAt)
	assert.True(t, stamps.ErasedAt.Equal(retiredAt), "personal_data_erased_at %s", stamps.ErasedAt)
}
