package owners

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type uploadRetentionDays int

func (d uploadRetentionDays) ResolveInt(context.Context, string) (int, error) { return int(d), nil }

// The nightly retention ages an unclaimed upload on the root clock, the one
// the upload's creation was stamped with (ADR 0265). At a pinned instant far
// before the real day, an upload created at that instant must stay; before,
// the retention measured with the real clock and deleted it at once.
func TestEnrollmentUploadRetentionMeasuresOnTheRootClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	ctx := context.Background()
	pinned := time.Date(2024, time.March, 5, 10, 0, 0, 0, time.UTC)
	var phaseID int64
	require.NoError(t, db.NewRaw(`INSERT INTO enrollment.phases
		(tenant_id, name, kind, service_start_date, service_end_date, is_active, care_overflow_mode, show_status_reason_to_parent)
		VALUES (?, ?, 'school_year', '2024-08-01', '2025-07-31', TRUE, 'waitlist', FALSE) RETURNING id`,
		tenantID, fmt.Sprintf("upload-retention-clock-%d", tenantID)).Scan(ctx, &phaseID))
	insertUpload := func(name string, createdAt time.Time) int64 {
		var id int64
		require.NoError(t, db.NewRaw(`INSERT INTO enrollment.request_uploads
			(tenant_id, phase_id, field_key, token_hash, filename_display, filename_stored, size_bytes, content_type, created_at)
			VALUES (?, ?, 'nachweis', ?, ?, ?, 1, 'application/pdf', ?) RETURNING id`,
			tenantID, phaseID, fmt.Sprintf("%s-%d", name, tenantID), name+".pdf", fmt.Sprintf("%s-%d.pdf", name, tenantID), createdAt).Scan(ctx, &id))
		return id
	}
	fresh := insertUpload("fresh", pinned)
	expired := insertUpload("expired", pinned.Add(-enrollmentOwner.UnclaimedUploadLifetime-time.Hour))

	step := enrollmentUploadRetentionStep(uploadRetentionDays(90), slog.Default(), func() time.Time { return pinned })
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, tenantID, func(txCtx context.Context) error {
		outcome, err := step.Run(txCtx)
		assert.Equal(t, 1, outcome.Deleted)
		return err
	}))

	var remaining []int64
	require.NoError(t, db.NewRaw(`SELECT id FROM enrollment.request_uploads WHERE tenant_id = ? ORDER BY id`, tenantID).Scan(ctx, &remaining))
	assert.Equal(t, []int64{fresh}, remaining, "the upload created at the root clock's instant stays, the one past its lifetime goes")
	assert.NotContains(t, remaining, expired)
}
