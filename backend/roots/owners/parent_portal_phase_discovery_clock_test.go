package owners

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The parent portal offers a phase while its window is open on the root
// clock, the clock the intake checks the submission on (ADR 0265). A pinned
// instant far from the real day shows the discovery does not read the real
// clock: before, a phase open at the pinned instant stayed hidden.
func TestParentPortalReadsDiscoverPhasesOnTheRootClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	account := testpkg.CreateTestAccount(t, db, "phase-discovery-clock")
	pinned := time.Date(2031, time.March, 4, 10, 0, 0, 0, time.UTC)
	insertPhase := func(name string, opens, closes time.Time) {
		_, err := db.NewRaw(`INSERT INTO enrollment.phases
			(tenant_id, name, kind, service_start_date, service_end_date, enrollment_open_at, enrollment_close_at,
			 is_active, care_overflow_mode, show_status_reason_to_parent)
			VALUES (?, ?, 'school_year', '2031-08-01', '2032-07-31', ?, ?, TRUE, 'waitlist', FALSE)`,
			tenantID, name, opens, closes).Exec(context.Background())
		require.NoError(t, err)
	}
	open := fmt.Sprintf("discovery-open-%d", tenantID)
	closed := fmt.Sprintf("discovery-closed-%d", tenantID)
	insertPhase(open, pinned.Add(-24*time.Hour), pinned.Add(24*time.Hour))
	insertPhase(closed, pinned.Add(-48*time.Hour), pinned.Add(-24*time.Hour))

	database := testpkg.NewDatabase(t, db)
	organizations, err := NewOrganizationTenancy(database)
	require.NoError(t, err)
	reads := NewParentPortalReads(database, MustNewPeopleDirectory(database), NewPeopleIdentityAccess(database, nil),
		func() time.Time { return pinned }, organizations)

	var names []string
	require.NoError(t, testpkg.WithinAdminContext(t, context.Background(), db, func(ctx context.Context) error {
		phases, err := reads.ParentEnrollablePhase.ListEnrollable(ctx, account.ID)
		for _, phase := range phases {
			names = append(names, phase.PhaseName)
		}
		return err
	}))
	assert.Contains(t, names, open, "the window is open at the root clock's instant")
	assert.NotContains(t, names, closed, "the window closed before the root clock's instant")
}
