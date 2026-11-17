package api

import (
	"context"
	"fmt"
)

// seedChildrenWithoutCarePlaceStep shows children of a class without an OGS
// place on every dev machine (#4803, ADR 0282): two class list entries, then
// the moto team's switch, which converts them, then one child created
// directly. It runs after the children of the school exist, so the entries
// share a real class.
type seedChildrenWithoutCarePlaceStep struct{}

func (seedChildrenWithoutCarePlaceStep) Name() string {
	return "Seeding children without an OGS place"
}

func (seedChildrenWithoutCarePlaceStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil {
		return fmt.Errorf("children without an OGS place: prerequisites not available")
	}
	class, err := seedFirstSchoolClass(rt)
	if err != nil {
		return err
	}
	for _, name := range [][2]string{{"Lea", "Lang"}, {"Mats", "Möller"}} {
		if _, err := rt.Client.PostWithAuth(rt.TenantAuth, "/api/class-list-entries", map[string]any{
			"first_name": name[0], "last_name": name[1], "school_class": class,
		}); err != nil {
			return fmt.Errorf("children without an OGS place: add class list entry: %w", err)
		}
	}
	path := fmt.Sprintf("/operator/schools/%d/settings/values/%s", rt.Bootstrap.SchoolID, "operations.children_without_care_place")
	if _, err := rt.Client.PutWithAuth(rt.OperatorAuth, path, map[string]any{"value": true}); err != nil {
		return fmt.Errorf("children without an OGS place: switch on: %w", err)
	}
	if _, err := rt.Client.PostWithAuth(rt.TenantAuth, "/api/students", map[string]any{
		"first_name": "Nele", "last_name": "Nowak", "school_class": class, "without_care_place": true,
	}); err != nil {
		return fmt.Errorf("children without an OGS place: create child: %w", err)
	}
	fmt.Printf("  Kinder ohne OGS-Platz: 3 in Klasse %s\n", class)
	return nil
}

// seedFirstSchoolClass is the class of the first child of the school.
func seedFirstSchoolClass(rt *Runtime) (string, error) {
	raw, err := rt.Client.GetWithAuth(rt.TenantAuth, "/api/students?page_size=1")
	if err != nil {
		return "", fmt.Errorf("children without an OGS place: read a class: %w", err)
	}
	var payload struct {
		Data []struct {
			SchoolClass string `json:"school_class"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &payload); err != nil {
		return "", fmt.Errorf("children without an OGS place: parse a class: %w", err)
	}
	if len(payload.Data) == 0 || payload.Data[0].SchoolClass == "" {
		return "", fmt.Errorf("children without an OGS place: the school has no child with a class")
	}
	return payload.Data[0].SchoolClass, nil
}
