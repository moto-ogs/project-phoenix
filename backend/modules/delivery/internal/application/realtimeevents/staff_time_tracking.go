package realtimeevents

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// QueueStaffTimeTrackingChanged emits a tenant-wide invalidation after the
// surrounding transaction commits.
func QueueStaffTimeTrackingChanged(ctx context.Context, broadcaster Publisher, logger *slog.Logger, reason string) {
	if broadcaster == nil {
		return
	}
	tenantID := tenant.FromContext(ctx)
	if tenantID == 0 {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	tenant.RegisterAfterCommit(ctx, func() {
		data := realtime.EventData{}
		if reason != "" {
			data.Reason = &reason
		}
		event := realtime.NewEvent(realtime.EventStaffTimeTrackingChanged, "", data)
		if err := broadcaster.BroadcastToTenant(tenantID, event); err != nil {
			logger.Warn("SSE staff time-tracking broadcast failed",
				slog.String("error", err.Error()),
				slog.Int64("tenant_id", tenantID),
			)
		}
	})
}
