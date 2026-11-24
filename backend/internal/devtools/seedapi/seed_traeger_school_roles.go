package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerSchoolRolesStep gives the demo Träger a role for the staff of
// all its schools (#4810, ADR 0317), through the route the Träger-Büro uses:
// „Springerkraft“ with the starting selection of the Betreuung. Every demo
// school of the Träger then lists it as a role „vom Träger“. Several demo
// schools seed the same Träger; a role another school's run created is no
// error.
type seedTraegerSchoolRolesStep struct{}

func (seedTraegerSchoolRolesStep) Name() string {
	return "Giving the schools a role of the Träger"
}

const (
	seedTraegerSchoolRoleName     = "Springerkraft"
	seedCodeTraegerSchoolRoleName = "traeger.school_role_name_taken"
)

func (seedTraegerSchoolRolesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger school role seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	raw, err := rt.Client.GetWithAuth(auth, "/traeger/school-roles/catalog")
	if err != nil {
		return fmt.Errorf("read the role catalog of the Träger: %w", err)
	}
	var catalog struct {
		Data struct {
			Templates []struct {
				BaseRole      string     `json:"base_role"`
				PermissionIDs []ident.ID `json:"permission_ids"`
			} `json:"templates"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return fmt.Errorf("decode the role catalog of the Träger: %w", err)
	}
	var selection []ident.ID
	for _, template := range catalog.Data.Templates {
		if template.BaseRole == "user" {
			selection = template.PermissionIDs
		}
	}
	if len(selection) == 0 {
		return errors.New("the role catalog of the Träger offers no starting selection for the Betreuung")
	}
	_, err = rt.Client.PostWithAuth(auth, "/traeger/school-roles/", map[string]any{
		"name": seedTraegerSchoolRoleName, "base_role": "user", "permission_ids": selection,
		"description": "Hilft an allen Standorten des Trägers aus und sieht dort dasselbe wie die Betreuung.",
	})
	var refused *APIError
	if err != nil && (!errors.As(err, &refused) || refused.Code != seedCodeTraegerSchoolRoleName) {
		return fmt.Errorf("create a role of the Träger for its schools: %w", err)
	}
	fmt.Printf("  Träger role for all schools: %s with %d rights\n", seedTraegerSchoolRoleName, len(selection))
	return nil
}
