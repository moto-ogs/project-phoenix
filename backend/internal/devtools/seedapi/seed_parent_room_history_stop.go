package api

import (
	"context"
	"fmt"
)

// seedParentRoomHistoryStopStep lets the demo parents stop the room history
// and the mood of their child (#3844): the demo Träger switches the parents'
// stop on, so the parents portal shows the row beside the photo consent.
type seedParentRoomHistoryStopStep struct{}

func (seedParentRoomHistoryStopStep) Name() string {
	return "Letting parents stop the room history"
}

// seedParentRoomHistoryStopKey is the Träger switch of the parents' stop.
const seedParentRoomHistoryStopKey = "gdpr.parent_room_history_stop_enabled"

func (seedParentRoomHistoryStopStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the parents' room history stop seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	if _, err := rt.Client.PutWithAuth(auth, "/traeger/settings/values/"+seedParentRoomHistoryStopKey, map[string]any{"value": true}); err != nil {
		return fmt.Errorf("let parents stop the room history: %w", err)
	}
	fmt.Println("  Parents portal: parents may stop the room history of their child")
	return nil
}
