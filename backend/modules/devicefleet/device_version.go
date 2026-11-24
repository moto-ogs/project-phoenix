package devicefleet

import "github.com/moto-ogs/project-phoenix/sharedkernel/readstate"

// deviceEditState is the canonical form of what the edit of a device
// (PUT /api/iot/{id}) writes back from its read: the device ID, the type,
// the name and who registered it. The status has routes of its own and an
// edit without one keeps it.
type deviceEditState struct {
	DeviceID       string  `json:"device_id"`
	DeviceType     string  `json:"device_type"`
	Name           *string `json:"name"`
	RegisteredByID *int64  `json:"registered_by_id"`
}

// DeviceVersion is the read-state token of a device's edit (ADR 0311). The
// heartbeat of a device (last_seen) moves updated_at through the row's
// trigger, so the token is a fingerprint of the edited columns, not
// readstate.Of.
func DeviceVersion(device *Device) string {
	if device == nil {
		return ""
	}
	return readstate.Fingerprint(deviceEditState{
		DeviceID: device.DeviceID, DeviceType: device.DeviceType,
		Name: device.Name, RegisteredByID: device.RegisteredByID,
	})
}
