package api

import (
	"errors"
	"fmt"
)

// „Person einstellen“ (#7206): the Personalverwaltung of the demo Träger
// hires one invented person at the seeded school, with the Akte, a contract
// from the start of the school year and the Soll at that Einsatzort. Several
// demo schools seed the same Träger; the personnel number tells a later run
// that the person is hired already.

// seedTraegerHireNumber is the invented personnel number of the hired person.
const seedTraegerHireNumber = "81001"

// seedTraegerStaffHire hires the person and reports whether this run did.
func seedTraegerStaffHire(client *Client, auth AuthRef, schoolID int64) (bool, error) {
	_, err := client.PostWithAuth(auth, "/traeger/staff-records/hire", map[string]any{
		"first_name": "Lena", "last_name": "Brandt", "birthday": "1990-04-12",
		"email": "lena.brandt@ganztag-nord.example", "personnel_number": seedTraegerHireNumber,
		"contract": map[string]any{"kind": "part_time", "starts_on": seedTraegerContractStart},
		"sites":    []map[string]any{{"school_id": schoolID, "weekday_minutes": []int{240, 240, 240, 240, 0}}},
		// A demo person of another run may share name and birthday.
		"confirm_duplicate": true,
	})
	var refused *APIError
	if errors.As(err, &refused) && refused.Code == seedCodeStaffNumberTaken {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("hire a person at the Träger: %w", err)
	}
	return true, nil
}

// seedTraegerStaffIntake brings new people to the Träger the two ways the
// Personalverwaltung has: the import from a file (#4724) and the hire of one
// person (#7206). It returns the imported records and whether it hired.
func seedTraegerStaffIntake(client *Client, auth AuthRef, schoolID int64) (int, bool, error) {
	imported, err := seedTraegerStaffImport(client, auth)
	if err != nil {
		return 0, false, err
	}
	hired, err := seedTraegerStaffHire(client, auth, schoolID)
	return imported, hired, err
}
