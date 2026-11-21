//go:build testhooks

package timetablehttp

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/tenant/tenanttest"
)

func TestQueueStaffingChangeAfterCommitSendsToExplicitTenant(t *testing.T) {
	t.Parallel()

	var received []struct {
		tenantID int64
		source   string
	}
	announcer := timetablePorts.StaffingAnnouncerFunc(func(tenantID int64, source string) error {
		received = append(received, struct {
			tenantID int64
			source   string
		}{tenantID: tenantID, source: source})
		return nil
	})
	ctx, commit := tenanttest.WithAfterCommitHooks(context.Background())

	QueueStaffingChangeAfterCommit(ctx, 42, "closing_days", announcer, nil)
	assert.Empty(t, received, "the signal must wait for the write to commit")

	commit()
	assert.Equal(t, []struct {
		tenantID int64
		source   string
	}{{tenantID: 42, source: "closing_days"}}, received)
}
