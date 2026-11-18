package organizationtenancy

import (
	"context"
	"fmt"
	"net"
)

// MaxDeviceSlots bounds the Geräteplätze of one school (#2312); it keeps the
// number a plausible contract value rather than a typo.
const MaxDeviceSlots = 1000

// ValidateDeviceSlots rejects a number of Geräteplätze outside the contract
// model. Nil removes the limit and is always valid.
func ValidateDeviceSlots(slots *int) error {
	if slots == nil {
		return nil
	}
	if *slots < 0 || *slots > MaxDeviceSlots {
		return invalidSchool(fmt.Sprintf("device slots must be between 0 and %d", MaxDeviceSlots))
	}
	return nil
}

// DeviceSlotLimits is the named tenant-safe read of the Geräteplätze (#2312).
// It answers only for the school of the tenant in context, on the caller's
// transaction. Limited is false when moto has not set a limit yet.
//
// LockDeviceSlotLimit first takes the per-school Geräteplatz lock, which the
// operator's change of the limit also holds, so a device registration checks
// the limit it commits against. DeviceSlotLimit reads without the lock: it
// shows a snapshot and decides nothing.
type DeviceSlotLimits interface {
	LockDeviceSlotLimit(ctx context.Context) (limit int, limited bool, err error)
	DeviceSlotLimit(ctx context.Context) (limit int, limited bool, err error)
}

// SchoolDeviceSlotCommand writes the Geräteplätze of a live school (#2312)
// on the caller's administrative transaction. It holds the per-school
// Geräteplatz lock that DeviceSlotLimits.LockDeviceSlotLimit takes too from
// the count of the occupied places to the write, so no registration slips in
// between. A limit below the occupied places is a
// DeviceSlotsBelowOccupiedError; the same limit changes nothing.
type SchoolDeviceSlotCommand interface {
	SetSchoolDeviceSlots(ctx context.Context, schoolID int64, slots *int, occupied func(context.Context) (int, error)) (DeviceSlotChange, error)
}

// DeviceSlotChange is the outcome of a Geräteplatz change: the limit before
// it, the occupied places it was checked against, and whether it changed
// anything.
type DeviceSlotChange struct {
	Previous *int
	Occupied int
	Changed  bool
}

// DeviceSlotProvisioning sets the Geräteplätze of a school for operators
// (#2312). The operator provisioning serves it beside its facade.
type DeviceSlotProvisioning interface {
	SetSchoolDeviceSlots(ctx context.Context, schoolID int64, slots *int, operatorID int64, clientIP net.IP) error
}

// DeviceSlotsBelowOccupiedError rejects lowering the Geräteplätze of a school
// below the number of its registered, not removed devices. Neither the limit
// nor any device changes.
type DeviceSlotsBelowOccupiedError struct {
	SchoolID  int64
	Requested int
	Occupied  int
}

func (e *DeviceSlotsBelowOccupiedError) Error() string {
	return fmt.Sprintf("school %d has %d registered devices, more than the %d requested device slots", e.SchoolID, e.Occupied, e.Requested)
}

// DeviceSlotsFullError rejects registering or moving a device into a school
// whose Geräteplätze are all occupied.
type DeviceSlotsFullError struct{ DeviceSlots int }

func (e *DeviceSlotsFullError) Error() string {
	return fmt.Sprintf("all %d device slots of the school are occupied", e.DeviceSlots)
}
