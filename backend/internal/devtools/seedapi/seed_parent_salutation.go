package api

import "fmt"

// seedParentSalutation lets the demo parent choose a form of address for
// their own profile (#7362), so the start page and the mails of the demo
// greet with "Frau" and the last name. The contact write replaces the
// profile's contact fields, so it sends back what the profile holds, with the
// version it read (ADR 0311).
func seedParentSalutation(rt *Runtime, auth AuthRef, studentID int64) error {
	raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("/parent/me/children/%d/guardians", studentID))
	if err != nil {
		return fmt.Errorf("load guardians for the form of address: %w", err)
	}
	var envelope struct {
		Data []map[string]any `json:"data"`
	}
	if err := parseJSON(raw, &envelope); err != nil {
		return fmt.Errorf("parse guardians for the form of address: %w", err)
	}
	for _, guardian := range envelope.Data {
		if self, _ := guardian["is_self"].(bool); !self {
			continue
		}
		body := map[string]any{"salutation": "ms", "phones": []any{}, "expected_version": guardian["version"]}
		for _, key := range []string{"first_name", "last_name", "email", "address_street", "address_city", "address_postal_code", "phones"} {
			if value, ok := guardian[key]; ok {
				body[key] = value
			}
		}
		if _, err := rt.Client.PutWithAuth(auth,
			fmt.Sprintf("/parent/me/children/%d/guardians/%v/contact", studentID, guardian["guardian_profile_id"]), body); err != nil {
			return fmt.Errorf("seed the parent's form of address: %w", err)
		}
		return nil
	}
	return fmt.Errorf("seed the parent's form of address: own profile not among the child's guardians")
}
