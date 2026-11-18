package api

import "fmt"

// demoBlockedDevice is a retired tablet the school blocked (Gerätesperre,
// #2317): it stays in the device list with its room and Geräteplatz, but
// its kiosk is refused. It is not a DemoDevice, so no simulation drives it.
var demoBlockedDevice = DemoDevice{DeviceID: "demo-device-blocked", Name: "Altes Tablet Flur"}

// seedBlockedDevice registers demoBlockedDevice and blocks it through the
// school's status route.
func (s *FixedSeeder) seedBlockedDevice() error {
	if _, err := s.client.Post("/api/iot/", map[string]any{
		"device_id":   demoBlockedDevice.DeviceID,
		"name":        demoBlockedDevice.Name,
		"device_type": "terminal",
		"status":      "active",
	}); err != nil {
		return fmt.Errorf("failed to create device %s: %w", demoBlockedDevice.DeviceID, err)
	}
	if _, err := s.client.Patch("/api/iot/"+demoBlockedDevice.DeviceID+"/status", map[string]string{"status": "inactive"}); err != nil {
		return fmt.Errorf("failed to block device %s: %w", demoBlockedDevice.DeviceID, err)
	}
	if s.verbose {
		fmt.Printf("  ✓ blocked device %s created\n", demoBlockedDevice.DeviceID)
	}
	return nil
}
