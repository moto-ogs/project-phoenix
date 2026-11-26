package api

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedSchoolResponsibilitiesStep gives the seeded school its Gemeinde
// (#4811, ADR 0318) through the Träger routes, the way the Träger-Büro
// writes it, and lets the Gemeinde employ the staff of the school. The page
// "Zuständigkeiten" then shows a school with its own value and a stored
// body, and the Personalakte names the Gemeinde at this Einsatzort.
// Contracts and billing stay with the Träger, so no seeded contract or
// invoice changes its sender.
type seedSchoolResponsibilitiesStep struct{}

func (seedSchoolResponsibilitiesStep) Name() string { return "Seeding the school's Gemeinde" }

// seedSchoolGemeinde is the invented Gemeinde of a demo school, with a
// creditor identifier of its own: a body never bills with the Träger's
// (#8040, ADR 0322 point 10).
var seedSchoolGemeinde = map[string]any{
	"name": "Gemeinde Bissendorf", "street": "Kirchplatz 1", "postal_code": "49143", "city": "Bissendorf",
	"contact_name": "Martina Vogt", "contact_phone": "+49 5402 404-0", "contact_email": "ganztag@bissendorf.example.test",
	"creditor_id": "DE82ZZZ00000043210", "account_holder": "Gemeinde Bissendorf",
	"iban": "DE02 1203 0000 0000 2020 51", "bic": "BYLADEM1001", "bank_name": "Deutsche Kreditbank",
	"expected_version": "",
}

func (seedSchoolResponsibilitiesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" || rt.Bootstrap.SchoolID <= 0 {
		return fmt.Errorf("the school responsibility seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	stored, err := seedSchoolHasGemeinde(rt.Client, auth, rt.Bootstrap.SchoolID)
	if err != nil {
		return err
	}
	if !stored {
		path := fmt.Sprintf("/traeger/master-data/responsibilities/schools/%d/parties/gemeinde", rt.Bootstrap.SchoolID)
		if _, err := rt.Client.PutWithAuth(auth, path, seedSchoolGemeinde); err != nil {
			return fmt.Errorf("store the Gemeinde of school %d: %w", rt.Bootstrap.SchoolID, err)
		}
	}
	// The school's own value: its Gemeinde employs the staff.
	path := fmt.Sprintf("/operator/schools/%d/settings/values/%s", rt.Bootstrap.SchoolID, "responsibility.staff")
	if _, err := rt.Client.PutWithAuth(rt.OperatorAuth, path, map[string]any{"value": "gemeinde"}); err != nil {
		return fmt.Errorf("let the Gemeinde employ the staff of school %d: %w", rt.Bootstrap.SchoolID, err)
	}
	fmt.Println("  School responsibilities: the Gemeinde with address and bank account employs the staff")
	return nil
}

// seedSchoolHasGemeinde tells whether the school already has its Gemeinde:
// a seed that runs again keeps it.
func seedSchoolHasGemeinde(client *Client, auth AuthRef, schoolID int64) (bool, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/master-data/responsibilities")
	if err != nil {
		return false, fmt.Errorf("read the responsibilities of the Träger's schools: %w", err)
	}
	var envelope struct {
		Data struct {
			Schools []struct {
				SchoolID ident.ID `json:"school_id"`
				Parties  []struct {
					Kind string `json:"kind"`
				} `json:"parties"`
			} `json:"schools"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return false, fmt.Errorf("read the responsibilities of the Träger's schools: %w", err)
	}
	for _, school := range envelope.Data.Schools {
		if int64(school.SchoolID) != schoolID {
			continue
		}
		for _, party := range school.Parties {
			if party.Kind == "gemeinde" {
				return true, nil
			}
		}
	}
	return false, nil
}
