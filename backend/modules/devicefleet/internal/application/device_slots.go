package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet/internal/domain"
)

// ErrDeviceSlotsNotComposed is returned when a graph without the Geräteplatz
// read registers a device or reads the usage.
var ErrDeviceSlotsNotComposed = errors.New("devicefleet: device slot limits are not composed")

var _ devicefleet.DeviceSlotQuery = (*Service)(nil)

// lockDeviceSlotLimit takes the school's Geräteplatz lock and returns its
// limit, nil when the school has none yet. A device that occupies no place
// takes neither.
func (s *Service) lockDeviceSlotLimit(ctx context.Context, deviceID string) (*int, error) {
	if !devicefleet.OccupiesDeviceSlot(deviceID) {
		return nil, nil
	}
	if s.deps.Slots == nil {
		return nil, ErrDeviceSlotsNotComposed
	}
	limit, limited, err := s.deps.Slots.LockDeviceSlotLimit(ctx)
	if err != nil {
		return nil, fmt.Errorf("devicefleet: read device slots: %w", err)
	}
	if !limited {
		return nil, nil
	}
	return &limit, nil
}

// DeviceSlotUsage reads the Geräteplätze of the school in context and how
// many of them its devices occupy (#2312). It takes no lock: it shows a
// snapshot and decides nothing.
func (s *Service) DeviceSlotUsage(ctx context.Context) (devicefleet.DeviceSlotUsage, error) {
	if s.deps.Slots == nil {
		return devicefleet.DeviceSlotUsage{}, ErrDeviceSlotsNotComposed
	}
	var usage devicefleet.DeviceSlotUsage
	err := s.runInTenant(ctx, "device_slot_usage", func(ctx context.Context, stats *domain.OperationStats) error {
		limit, limited, err := s.deps.Slots.DeviceSlotLimit(ctx)
		if err != nil {
			return fmt.Errorf("read device slots: %w", err)
		}
		occupied, queryStats, err := s.deps.Devices.CountSlotDevices(ctx)
		stats.Add(queryStats)
		if err != nil {
			return err
		}
		usage = devicefleet.DeviceSlotUsage{Limited: limited, Occupied: occupied}
		if limited {
			usage.Booked = limit
		}
		return nil
	})
	return usage, err
}
