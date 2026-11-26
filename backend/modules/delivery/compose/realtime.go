package compose

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/application/realtimeevents"
	"github.com/moto-ogs/project-phoenix/realtime"
)

// NewTenantSignal binds one contentless staff event to the shared after-commit site (ADR 0310).
func NewTenantSignal(broadcaster realtimeevents.TenantPublisher, logger *slog.Logger, event realtime.EventType) realtimeevents.BoundTenantSignal {
	return realtimeevents.BoundTenantSignal{Broadcaster: broadcaster, Logger: logger, Signal: realtimeevents.TenantSignal(event)}
}

// StartedInstance names the timetable instance a kiosk session started.
type StartedInstance = realtimeevents.StartedInstance

// QueueInstanceStarted announces a started instance after the commit (kiosk session mirror).
func QueueInstanceStarted(ctx context.Context, broadcaster realtime.Broadcaster, logger *slog.Logger, instance StartedInstance) {
	realtimeevents.QueueInstanceStarted(ctx, broadcaster, logger, instance)
}

// QueueArrivalScheduleChanged announces an arrival schedule change after the commit (class day).
func QueueArrivalScheduleChanged(ctx context.Context, broadcaster realtimeevents.TenantPublisher, logger *slog.Logger) {
	realtimeevents.QueueArrivalScheduleChanged(ctx, broadcaster, logger)
}

// NewGroupEvents binds School Structure's post-commit invalidations.
func NewGroupEvents(broadcaster RealtimePublisher, logger *slog.Logger) realtimeevents.GroupEvents {
	return realtimeevents.GroupEvents{Broadcaster: broadcaster, Logger: logger}
}
