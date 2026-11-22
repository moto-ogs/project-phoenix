package api

import (
	"encoding/json"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedHolidayGuestGroupHint reads the Feriengruppen the group management
// explains (ADR 0120, Nachtrag 2026-11-11): the seeded week lies in the
// coming autumn holidays, so the group waits empty for it, stays out of the
// daily group lists and shows its week and guests in the group management.
func seedHolidayGuestGroupHint(rt *Runtime, groupID int64) error {
	raw, err := rt.Client.GetWithAuth(rt.TenantAuth, "/api/holiday-guests/groups")
	if err != nil {
		return fmt.Errorf("list the holiday guest groups: %w", err)
	}
	var envelope struct {
		Data []struct {
			GroupID ident.ID `json:"group_id"`
			Guests  int      `json:"guests"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("decode the holiday guest groups: %w", err)
	}
	for _, group := range envelope.Data {
		if int64(group.GroupID) == groupID && group.Guests > 0 {
			return nil
		}
	}
	return fmt.Errorf("the group management does not name the Feriengruppe with its guests")
}
