package api

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

func (s *FixedSeeder) seedGroupHandover(_ context.Context) error {
	groupID, ok := s.groupIDs["sternengruppe"]
	if !ok {
		return fmt.Errorf("group not found: sternengruppe")
	}
	targetStaffID, ok := s.staffIDs["Daria Nowak"]
	if !ok {
		return fmt.Errorf("staff not found: Daria Nowak")
	}

	today := todaySeedDate()
	_, err := s.client.Post("/api/substitutions", map[string]any{
		"type": "group_handover",
		"group_handover": map[string]any{
			"group_id": ident.ID(groupID), "target_staff_id": ident.ID(targetStaffID),
			"start_date": today.String(), "end_date": today.AddDays(2).String(),
		},
	})
	return err
}
