package api

import (
	"encoding/json"
	"fmt"
)

// demoBlockedDevice is a retired tablet the school blocked (Gerätesperre,
// #2317): it stays in the device list with its room and Geräteplatz, but
// its kiosk is refused. It is not a DemoDevice, so no simulation drives it.
var demoBlockedDevice = DemoDevice{DeviceID: "demo-device-blocked", Name: "Altes Tablet Flur"}

// demoBlockedDeviceFirstName is the name the tablet had before the school
// retired it; the rename fills its history (#2321).
const demoBlockedDeviceFirstName = "Tablet Flur"

// seedBlockedDevice registers demoBlockedDevice, renames it and blocks it
// through the school's routes, so its history shows a creation, an edit and
// a block.
func (s *FixedSeeder) seedBlockedDevice() error {
	created, err := s.client.Post("/api/iot/", map[string]any{
		"device_id":   demoBlockedDevice.DeviceID,
		"name":        demoBlockedDeviceFirstName,
		"device_type": "terminal",
		"status":      "active",
	})
	if err != nil {
		return fmt.Errorf("failed to create device %s: %w", demoBlockedDevice.DeviceID, err)
	}
	var device struct {
		Data struct {
			ID int64 `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created, &device); err != nil {
		return fmt.Errorf("failed to parse device %s: %w", demoBlockedDevice.DeviceID, err)
	}
	if _, err := s.client.Put(fmt.Sprintf("/api/iot/%d", device.Data.ID), map[string]any{
		"device_id":   demoBlockedDevice.DeviceID,
		"name":        demoBlockedDevice.Name,
		"device_type": "terminal",
	}); err != nil {
		return fmt.Errorf("failed to rename device %s: %w", demoBlockedDevice.DeviceID, err)
	}
	if _, err := s.client.Patch("/api/iot/"+demoBlockedDevice.DeviceID+"/status", map[string]string{"status": "inactive"}); err != nil {
		return fmt.Errorf("failed to block device %s: %w", demoBlockedDevice.DeviceID, err)
	}
	if s.verbose {
		fmt.Printf("  ✓ blocked device %s created\n", demoBlockedDevice.DeviceID)
	}
	return nil
}
