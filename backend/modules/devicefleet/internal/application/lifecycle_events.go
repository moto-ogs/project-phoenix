package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet/internal/domain"
)

var _ devicefleet.LifecycleHistory = (*Service)(nil)

// RecordLifecycleEvent appends one entry to the device's history in the
// caller's transaction, so the entry commits or rolls back with the change
// it describes (#2321). The owner's clock stamps it, the clock that also
// stamps last_seen.
func (s *Service) RecordLifecycleEvent(ctx context.Context, input devicefleet.RecordLifecycleEvent) error {
	if err := input.Validate(); err != nil {
		return s.reject("record_device_lifecycle_event", err)
	}
	return s.runWrite(ctx, "record_device_lifecycle_event", func(ctx context.Context, stats *domain.OperationStats) error {
		found, queryStats, err := s.deps.History.Insert(ctx, input, s.deps.Now())
		stats.Add(queryStats)
		if err != nil {
			return err
		}
		if !found {
			return devicefleet.ErrDeviceNotFound
		}
		return nil
	})
}

// ListLifecycleEvents reads a device's history, newest first.
func (s *Service) ListLifecycleEvents(ctx context.Context, deviceRowID int64) ([]devicefleet.LifecycleEvent, error) {
	if deviceRowID <= 0 {
		return nil, s.reject("list_device_lifecycle_events", devicefleet.ErrInvalidLifecycleEvent)
	}
	var events []devicefleet.LifecycleEvent
	err := s.runInTenant(ctx, "list_device_lifecycle_events", func(ctx context.Context, stats *domain.OperationStats) error {
		stored, found, queryStats, err := s.deps.History.List(ctx, deviceRowID)
		stats.Add(queryStats)
		if err != nil {
			return err
		}
		if !found {
			return devicefleet.ErrDeviceNotFound
		}
		events = stored
		return nil
	})
	if err != nil {
		return nil, err
	}
	return events, nil
}

// lifecycleRecord stamps the actor of a write that records itself in the
// history with the owner's clock; nil records nothing.
func (s *Service) lifecycleRecord(actor *devicefleet.LifecycleActorRef) *domain.LifecycleRecord {
	if actor == nil {
		return nil
	}
	record := &domain.LifecycleRecord{ActorKind: string(actor.Kind), OccurredAt: s.deps.Now()}
	id := actor.ID
	if actor.Kind == devicefleet.LifecycleActorOperator {
		record.OperatorID = &id
	} else {
		record.AccountID = &id
	}
	return record
}
