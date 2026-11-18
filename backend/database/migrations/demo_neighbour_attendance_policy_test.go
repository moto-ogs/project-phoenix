package migrations

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestDemoRoleReadsAttendanceOnlyInRegisteredSchoolScope(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	primary, slug := testpkg.CreateTestTenant(t, db)
	neighbour, _ := testpkg.CreateTestTenant(t, db)
	unrelated, _ := testpkg.CreateTestTenant(t, db)
	day := calendar.NewDate(2026, time.November, 18)
	for _, school := range []int64{primary, neighbour, unrelated} {
		child := testpkg.CreateTestStudentForTenant(t, db, school, "Demo", "Kind", "2a")
		staff := testpkg.CreateTestStaffForTenant(t, db, school, "Demo", "Leitung")
		device := testpkg.CreateTestDeviceForTenant(t, db, school, fmt.Sprintf("demo-web-%d", school))
		testpkg.CreateTestAttendanceForTenant(t, db, school, child.ID, staff.ID, device.ID, day, day.BerlinMidnight().Add(13*time.Hour), nil)
	}
	_, err := db.ExecContext(t.Context(), `INSERT INTO platform.demo_school_states (name, tenant_id, visitor_school_ids)
		VALUES (?, ?, ARRAY[?::bigint])`, slug, primary, neighbour)
	require.NoError(t, err)
	for _, check := range []struct{ school, want int64 }{
		{primary, 1}, {neighbour, 1}, {unrelated, 0},
	} {
		asDemoProcess(t, db, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', ?, true)", fmt.Sprint(check.school)); err != nil {
				return err
			}
			var count int64
			// Deliberately omit a tenant filter to assert the role still
			// sees at most the selected school's attendance.
			if err := tx.NewRaw("SELECT count(*) FROM active.attendance").Scan(ctx, &count); err != nil {
				return err
			}
			assert.Equal(t, check.want, count, "school %d", check.school)
			return nil
		})
	}
}
