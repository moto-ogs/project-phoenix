package api

import "fmt"

// storeDemoBankDetails stores the IBAN of the payer DemoGuardians[index]. A
// guardian of several children stores it with the first child only.
func (s *FixedSeeder) storeDemoBankDetails(index int, guardian DemoGuardian, guardianID int64, ibanIndex int) (bool, error) {
	if guardian.StudentIndex%4 == 3 || demoGuardianFirstIndex(guardian) != index {
		// Payer known, bank details still missing.
		return false, nil
	}
	body := map[string]any{"iban": demoIBAN(ibanIndex)}
	if guardian.StudentIndex%5 == 2 {
		// A Kontoinhaber that differs from the guardian: the account runs
		// on the partner's name.
		body["account_holder"] = fmt.Sprintf("%s %s", guardian.FirstName, guardian.LastName+"-Berger")
	}
	// The bank write saves against the version of the section it read
	// (ADR 0311).
	paymentPath := fmt.Sprintf("/api/guardians/%d/payment", guardianID)
	raw, err := s.client.Get(paymentPath)
	if err != nil {
		return false, fmt.Errorf("read bank details of guardian %s: %w", demoGuardianKey(guardian), err)
	}
	var read struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &read); err != nil {
		return false, fmt.Errorf("parse bank details of guardian %s: %w", demoGuardianKey(guardian), err)
	}
	body["expected_version"] = read.Data.Version
	if _, err := s.client.Put(paymentPath, body); err != nil {
		return false, fmt.Errorf("store bank details for guardian %s: %w", demoGuardianKey(guardian), err)
	}
	return true, nil
}
