package api

import (
	"encoding/json"
	"fmt"
)

// seedTraegerStaffBirthday is the invented birthday the Personalverwaltung
// enters in the first record (#8208).
const seedTraegerStaffBirthday = "1988-03-14"

// seedTraegerStaffFirstRecord keeps an IBAN in the first record and enters
// its birthday; 0 means another school's run created it, nothing to do.
func seedTraegerStaffFirstRecord(client *Client, auth AuthRef, first int64) error {
	if first <= 0 {
		return nil
	}
	if err := seedTraegerStaffFinancial(client, auth, first); err != nil {
		return err
	}
	return seedTraegerStaffPerson(client, auth, first)
}

// seedTraegerStaffPerson enters a birthday in the first record that its
// schools do not know, through the correction of the person (#7379), as
// the form does. The record then names every Einsatzort under „Andere
// Angaben an Schulen“ (#8208), so the take-over has something to show on
// every dev machine. A record that already keeps a birthday stays as it is.
func seedTraegerStaffPerson(client *Client, auth AuthRef, recordID int64) error {
	path := fmt.Sprintf("/traeger/staff-records/%d", recordID)
	raw, err := client.GetWithAuth(auth, path)
	if err != nil {
		return fmt.Errorf("read a Träger staff record: %w", err)
	}
	var record struct {
		Data struct {
			FirstName     string `json:"first_name"`
			LastName      string `json:"last_name"`
			Birthday      string `json:"birthday"`
			PersonVersion string `json:"person_version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return fmt.Errorf("decode a Träger staff record: %w", err)
	}
	if record.Data.Birthday != "" {
		return nil
	}
	if _, err := client.PutWithAuth(auth, path+"/person", map[string]any{
		"first_name": record.Data.FirstName, "last_name": record.Data.LastName,
		"birthday": seedTraegerStaffBirthday, "expected_version": record.Data.PersonVersion,
	}); err != nil {
		return fmt.Errorf("enter the birthday of a Träger staff record: %w", err)
	}
	return nil
}
