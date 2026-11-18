package api

import (
	"context"
	"fmt"
)

// deviceSlotSeedHeadroom is how many Geräteplätze the demo school keeps
// free (#2312), so the school portal shows occupied and free places and one
// more device can still be registered before the limit refuses it.
const deviceSlotSeedHeadroom = 1

// seedDeviceSlotsStep gives the full demo school Geräteplätze just above its
// registered devices through the operator route. It runs after every step
// that registers or moves devices, so none of them is refused.
type seedDeviceSlotsStep struct{}

func (seedDeviceSlotsStep) Name() string { return "Seeding the Geräteplätze" }

func (seedDeviceSlotsStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil {
		return fmt.Errorf("device slot demo prerequisites not available")
	}
	raw, err := rt.Client.GetWithAuth(rt.TenantAuth, "/api/iot/device-slots")
	if err != nil {
		return fmt.Errorf("read device slots: %w", err)
	}
	var payload struct {
		Data struct {
			Occupied int `json:"occupied"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &payload); err != nil {
		return fmt.Errorf("parse device slots: %w", err)
	}
	slots := payload.Data.Occupied + deviceSlotSeedHeadroom
	path := fmt.Sprintf("/operator/schools/%d/device-slots", rt.Bootstrap.SchoolID)
	if _, err := rt.Client.PutWithAuth(rt.OperatorAuth, path, map[string]any{"device_slots": slots}); err != nil {
		return fmt.Errorf("set device slots: %w", err)
	}
	fmt.Printf("  Geräteplätze: %d places, %d occupied\n", slots, payload.Data.Occupied)
	return nil
}
