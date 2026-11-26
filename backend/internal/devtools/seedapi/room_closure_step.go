package api

import (
	"context"
	"fmt"
)

// seedRoomClosureRoom is the demo room closed from tomorrow on (#7653), so
// the room page shows a closure and the pickers a closed room on every dev
// machine. Today stays open: the simulated day runs sessions in every room.
const seedRoomClosureRoom = "Werkraum"

type seedRoomClosureStep struct{}

func (seedRoomClosureStep) Name() string { return "Seeding a room closure" }

func (seedRoomClosureStep) Run(_ context.Context, rt *Runtime) error {
	if rt.FixedSeeder == nil {
		return fmt.Errorf("fixed seeder not available")
	}
	roomID, ok := rt.FixedSeeder.roomIDs[seedRoomClosureRoom]
	if !ok {
		return fmt.Errorf("room closure demo room not available")
	}
	day := rt.FixedSeeder.seedDay
	if _, err := rt.Client.Post(fmt.Sprintf("/api/rooms/%d/closures", roomID), map[string]any{
		"start_date": day.AddDays(1).String(),
		"end_date":   day.AddDays(3).String(),
		"reason":     "Wasserschaden",
	}); err != nil {
		return fmt.Errorf("seed room closure: %w", err)
	}
	fmt.Println("  1 room closure set")
	return nil
}
