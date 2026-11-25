package realtimeevents

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// TenantSignal names one tenant-wide staff signal without content (ADR 0310).
// Each signal is bound to exactly one event; the values below are the whole
// set. A new signal is a new value here and an event in realtime/events.go,
// never a new after-commit site.
type TenantSignal uint8

// The signals that leave through the shared after-commit site.
const (
	// CalendarAppointmentsChanged: an appointment of the school was written
	// (#7693).
	CalendarAppointmentsChanged TenantSignal = iota + 1
	StaffTimeTrackingChanged
	StaffLeaveChanged
)

// event is the one event a signal is bound to; false for an unknown value.
func (signal TenantSignal) event() (realtime.EventType, bool) {
	switch signal {
	case CalendarAppointmentsChanged:
		return realtime.EventCalendarAppointmentsChanged, true
	case StaffTimeTrackingChanged:
		return realtime.EventStaffTimeTrackingChanged, true
	case StaffLeaveChanged:
		return realtime.EventStaffLeaveChanged, true
	default:
		return "", false
	}
}

// BoundTenantSignal is Delivery's shared after-commit site for tenant-wide
// signals without content (ADR 0310), bound to one signal. Owners reach it
// through a change port the root binds to it; no owner gets an after-commit
// site of its own for such a signal.
type BoundTenantSignal struct {
	Broadcaster TenantPublisher
	Logger      *slog.Logger
	Signal      TenantSignal
}

// Announce sends the bound signal's event, with empty data, to the staff
// sessions of the context's school after the surrounding transaction
// commits. A rollback drops it. The signal is a losable hint: readers
// refetch on focus, reconnect and their poll, so a lost event delays a
// refresh and loses no record.
func (s BoundTenantSignal) Announce(ctx context.Context) {
	broadcaster, logger, signal := s.Broadcaster, s.Logger, s.Signal
	if broadcaster == nil {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	kind, ok := signal.event()
	if !ok {
		logger.Warn("skipping unknown tenant signal",
			"signal", int(signal),
		)
		return
	}
	tenantID := tenant.FromContext(ctx)
	if tenantID <= 0 {
		logger.Warn("skipping tenant signal without valid tenant",
			"event_type", string(kind),
			"tenant_id", tenantID,
		)
		return
	}
	tenant.RegisterAfterCommit(ctx, func() {
		if err := broadcaster.BroadcastToTenant(tenantID, realtime.NewEvent(kind, "", realtime.EventData{})); err != nil {
			logger.Warn("tenant signal broadcast failed",
				"event_type", string(kind),
				"tenant_id", tenantID,
				"error", err.Error(),
			)
		}
	})
}
