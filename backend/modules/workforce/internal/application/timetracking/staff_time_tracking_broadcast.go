package timetracking

import (
	"context"
	"log/slog"
)

// queueStaffTimeTrackingChanged announces a time-account change through the
// event port. A service without a bound publisher (bare unit fixtures) stays
// silent, exactly as the Delivery producer does for a nil broadcaster.
func queueStaffTimeTrackingChanged(ctx context.Context, broadcaster EventPublisher, logger *slog.Logger, reason string) {
	if broadcaster == nil {
		return
	}
	broadcaster.QueueStaffTimeTrackingChanged(ctx, logger, reason)
}
