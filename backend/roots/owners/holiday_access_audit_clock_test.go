package owners

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A read of a holiday participant list is dated by the Audit clock, the
// clock whose following-year cutoff the access-log retention deletes with
// (ADR 0281). The Audit clock stands years after the database clock: the
// fresh read stays and only an access of two years before goes. Before, the
// writer dated the read with the real clock, and the retention deleted it.
func TestHolidayParticipantAccessIsKeptByTheRetentionOfTheAuditClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	ctx := context.Background()
	account := testpkg.CreateTestAccount(t, db, "holiday-access-clock@example.test")
	now := time.Date(2031, time.March, 30, 1, 30, 0, 0, calendar.Berlin)
	clock := func() time.Time { return now }
	audits, err := auditCompose.NewTenantPersistence(db, clock)
	require.NoError(t, err)
	command, err := auditCompose.NewObservedCommand(audits.AppendStore, slog.Default(), func(string, time.Duration, int, error) {}, clock)
	require.NoError(t, err)
	week := calendar.DateFromTime(now)
	aged := &auditModels.DataAccessLog{ActorAccountID: account.ID, ActorRole: "admin", ResourceType: auditModels.ResourceTypeHolidayParticipants,
		RangeStart: now.AddDate(-2, 0, 0), RangeEnd: now.AddDate(-2, 0, 0), AccessedAt: now.AddDate(-2, 0, 0)}

	var deleted int
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, tenantID, func(txCtx context.Context) error {
		require.NoError(t, NewHolidayParticipantAccessLog(audits.DataAccessLog).RecordHolidayParticipantAccess(txCtx, enrollmentOwner.HolidayParticipantAccess{
			ActorAccountID: account.ID, ActorRole: "admin", WeekID: 1, StartsOn: week, EndsOn: week.AddDays(4), Participants: 3,
		}))
		require.NoError(t, audits.DataAccessLog.Create(txCtx, aged))
		var err error
		deleted, _, err = command.DeleteExpiredDataAccessLog(txCtx)
		return err
	}))

	var remaining []time.Time
	require.NoError(t, db.NewRaw(`SELECT accessed_at FROM audit.data_access_log WHERE tenant_id = ? ORDER BY id`, tenantID).Scan(ctx, &remaining))
	assert.Equal(t, 1, deleted, "only the access of two years before is past the cutoff")
	require.Len(t, remaining, 1, "the fresh read stays")
	assert.True(t, now.Equal(remaining[0]), "the read carries the instant of the Audit clock")
}
