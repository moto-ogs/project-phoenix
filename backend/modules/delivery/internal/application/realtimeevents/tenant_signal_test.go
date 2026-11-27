package realtimeevents

import (
	"context"
	"testing"
)

type tenantSignalPublisher struct{ events []Event }

func (p *tenantSignalPublisher) BroadcastToTenant(_ int64, event Event) error {
	p.events = append(p.events, event)
	return nil
}

// Each signal is bound to exactly one event; a value outside the set has none.
func TestTenantSignalsAreBoundToOneEvent(t *testing.T) {
	t.Parallel()
	if kind, ok := CalendarAppointmentsChanged.event(); !ok || kind != EventCalendarAppointmentsChanged {
		t.Fatalf("calendar signal is bound to %q (%v)", kind, ok)
	}
	if kind, ok := TenantSignal(EventActivityStart).event(); ok {
		t.Fatalf("an unknown signal is bound to %q", kind)
	}
}

// Without a school or with an unknown signal nothing leaves. The send after
// the commit is pinned where the root binds the site (roots/owners).
func TestBoundTenantSignalSendsNothingWithoutSchoolOrKnownSignal(t *testing.T) {
	t.Parallel()
	publisher := &tenantSignalPublisher{}
	BoundTenantSignal{Broadcaster: publisher, Signal: CalendarAppointmentsChanged}.Announce(context.Background())
	BoundTenantSignal{Broadcaster: publisher}.Announce(context.Background())
	BoundTenantSignal{Signal: CalendarAppointmentsChanged}.Announce(context.Background())
	if len(publisher.events) != 0 {
		t.Fatalf("sent %v", publisher.events)
	}
}
