package api

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// fetchRoles retrieves available roles from the API
func (s *FixedSeeder) fetchRoles(_ context.Context) error {
	respBody, err := s.client.Get("/auth/roles")
	if err != nil {
		return fmt.Errorf("failed to fetch roles: %w", err)
	}

	var resp struct {
		Status string `json:"status"`
		Data   []struct {
			ID   ident.ID `json:"id"`
			Name string   `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return fmt.Errorf("failed to parse roles response: %w", err)
	}

	for _, role := range resp.Data {
		s.roleIDs[role.Name] = int64(role.ID)
	}

	if s.verbose {
		fmt.Printf("  ✓ %d roles found\n", len(s.roleIDs))
	}
	return nil
}
