package api

import (
	"encoding/json"
	"fmt"
)

// The Personal-Import of the demo Träger (#4724): the Personalverwaltung
// previews a small file from its payroll program and takes it over with
// the fingerprint of that preview, as the office does. The people are
// invented; a repeated seed finds them and creates no duplicate.

// seedTraegerStaffImportFile is the file: three new people, one with
// invented bank and tax values with valid checksums.
const seedTraegerStaffImportFile = "Pers.-Nr.;Vorname;Nachname;Geburtsdatum;IBAN;Steuer-ID\r\n" +
	"70201;Jana;Wolff;12.03.1991;DE86529976247075280598;51830264971\r\n" +
	"70202;Malte;Brinkmann;27.08.1985;;\r\n" +
	"70203;Sophie;Kaya;04.01.1996;;\r\n"

const seedTraegerStaffImportName = "personal-lohnbuero.csv"

// seedTraegerStaffImport previews and takes over the file and returns how
// many records it created.
func seedTraegerStaffImport(client *Client, auth AuthRef) (int, error) {
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/staff-record-imports/preview", "file", seedTraegerStaffImportName,
		[]byte(seedTraegerStaffImportFile), nil)
	if err != nil {
		return 0, fmt.Errorf("preview the Personal-Import: %w", err)
	}
	var preview struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &preview); err != nil {
		return 0, fmt.Errorf("read the Personal-Import preview: %w", err)
	}
	raw, err = client.PostFileWithAuthFields(auth, "/traeger/staff-record-imports/", "file", seedTraegerStaffImportName,
		[]byte(seedTraegerStaffImportFile), map[string]string{"fingerprint": preview.Data.Fingerprint})
	if err != nil {
		return 0, fmt.Errorf("take over the Personal-Import: %w", err)
	}
	var result struct {
		Data struct {
			Counts struct {
				Imported int `json:"imported"`
			} `json:"counts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return 0, fmt.Errorf("read the Personal-Import: %w", err)
	}
	return result.Data.Counts.Imported, nil
}
