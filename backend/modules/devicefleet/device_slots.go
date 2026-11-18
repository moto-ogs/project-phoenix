package devicefleet

import (
	"context"
	"errors"
	"fmt"
)

// ErrDeviceSlotsFull rejects registering a device at a school whose
// Geräteplätze are all occupied (#2312). DeviceSlotsFullError carries the
// limit and matches it.
var ErrDeviceSlotsFull = errors.New("devicefleet: no free device slot")

// DeviceSlotsFullError names the limit a registration ran into.
type DeviceSlotsFullError struct{ DeviceSlots int }

func (e *DeviceSlotsFullError) Error() string {
	return fmt.Sprintf("%s: all %d device slots are occupied", ErrDeviceSlotsFull, e.DeviceSlots)
}

// Is keeps errors.Is(err, ErrDeviceSlotsFull) true.
func (e *DeviceSlotsFullError) Is(target error) bool { return target == ErrDeviceSlotsFull }

// OccupiesDeviceSlot reports whether a live device takes one of the school's
// Geräteplätze: every device except the virtual manual web check-in device,
// which no kiosk stands behind. Blocked devices keep their place; removed
// ones are archived and no longer live.
func OccupiesDeviceSlot(deviceID string) bool { return deviceID != WebManualDeviceID }

// DeviceSlotUsage is the Geräteplatz state of the school in context.
// Limited is false while moto has not set a limit; Booked is then zero.
type DeviceSlotUsage struct {
	Booked   int
	Limited  bool
	Occupied int
}

// Free is the number of places a new device can take, never below zero; it
// is only meaningful for a limited school.
func (u DeviceSlotUsage) Free() int {
	if u.Occupied >= u.Booked {
		return 0
	}
	return u.Booked - u.Occupied
}

// DeviceSlotQuery reads the Geräteplätze of the school in context (#2312).
type DeviceSlotQuery interface {
	DeviceSlotUsage(context.Context) (DeviceSlotUsage, error)
}
