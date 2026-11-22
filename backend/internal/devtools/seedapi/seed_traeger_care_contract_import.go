package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerCareContractImportStep takes over existing contracts of the
// seeded school from a file (#4723). It runs after the contracts of the
// applications are signed and billed: an imported contract is active at once,
// and the steps before read the active contracts of the school to decide
// which draft is signed on paper and which month is billed first.
type seedTraegerCareContractImportStep struct{}

func (seedTraegerCareContractImportStep) Name() string {
	return "Importing existing Träger care contracts"
}

func (seedTraegerCareContractImportStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger care contract import seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	imported, err := seedImportedCareContracts(rt.Client, auth, rt.Bootstrap.SchoolID)
	if err != nil {
		return err
	}
	fmt.Printf("  Träger care contract import: %d contracts taken over\n", imported)
	return nil
}

// seedImportTries bounds the modules the seed offers the import: the first
// whose phase still runs next month takes the file.
const seedImportTries = 6

// seedImportedCareContracts takes over four children with their existing
// contracts from a CSV export of another program (#4723), so the demo shows
// imported contracts and the import log. The contracts start next month, so
// no monthly run of the seed bills them. They belong to the seeded school,
// like every contract of this step, so a school seeded later leaves those
// of the other demo schools alone. A repeated seed finds the children again
// and takes over nothing.
func seedImportedCareContracts(client *Client, auth AuthRef, school int64) (int, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/contract-templates/")
	if err != nil {
		return 0, fmt.Errorf("read the contract templates for the import: %w", err)
	}
	var templates struct {
		Data []struct {
			SchoolID     ident.ID        `json:"school_id"`
			SchoolName   string          `json:"school_name"`
			OfferingName string          `json:"offering_name"`
			Active       bool            `json:"active"`
			Template     json.RawMessage `json:"template"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &templates); err != nil {
		return 0, fmt.Errorf("read the contract templates for the import: %w", err)
	}
	today := calendar.TodayDate()
	start := calendar.NewDate(today.Year(), today.Month()+1, 1).Format("02.01.2006")
	tries := 0
	for _, offering := range templates.Data {
		if int64(offering.SchoolID) != school || !offering.Active || len(offering.Template) == 0 || string(offering.Template) == "null" {
			continue
		}
		if tries++; tries > seedImportTries {
			break
		}
		imported, ready, err := seedCareContractImport(client, auth, offering.SchoolName, offering.OfferingName, start)
		if err != nil || ready {
			return imported, err
		}
	}
	return 0, nil
}

// seedCareContractImport previews the file for one module like the office
// and takes over what the preview showed. ready is false when the module
// takes no row, so the caller offers the next one.
func seedCareContractImport(client *Client, auth AuthRef, school, module, start string) (int, bool, error) {
	// The last column is how many children the family has (#7356); moto
	// keeps it only for an account that bills. Ida's row names no parents,
	// as the master data of OGS Connect does: her contract is a family of
	// its own, known by the contract.
	rows := []string{"Vorname Kind;Nachname Kind;Geburtsdatum;Schule;Modul;Vertragsbeginn;Vorname Eltern;Nachname Eltern;E-Mail;Kinder in der Familie"}
	for _, child := range [][5]string{
		{"Jonte", "Petersen", "14.03.2018", "Maren", "2"},
		{"Malia", "Okafor", "02.09.2019", "Chidi", ""},
		{"Emil", "Wagner", "27.11.2017", "Sabine", "3"},
		{"Ida", "Brandt", "19.06.2018", "", "2"},
	} {
		parentLast, email := child[1], strings.ToLower(child[3]+"."+child[1])+"@familie.example.test"
		if child[3] == "" {
			parentLast, email = "", ""
		}
		rows = append(rows, strings.Join([]string{child[0], child[1], child[2], school, module, start, child[3], parentLast, email, child[4]}, ";"))
	}
	csv := []byte(strings.Join(rows, "\r\n") + "\r\n")
	const file = "ogs-connect-stammdaten.csv"
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/contract-imports/preview", "file", file, csv, nil)
	if err != nil {
		return 0, false, fmt.Errorf("preview the import of care contracts: %w", err)
	}
	var preview seedContractImportAnswer
	if err := json.Unmarshal(raw, &preview); err != nil {
		return 0, false, fmt.Errorf("read the preview of the contract import: %w", err)
	}
	if preview.Data.Counts.Ready == 0 {
		// A repeated seed finds the children again: nothing is left to do.
		// Their corrections belong to the run that took them over, so a
		// contract somebody changed by hand since stays as it is.
		return 0, preview.Data.Counts.Duplicate > 0, nil
	}
	raw, err = client.PostFileWithAuthFields(auth, "/traeger/contract-imports/", "file", file, csv,
		map[string]string{"fingerprint": preview.Data.Fingerprint})
	if err != nil {
		return 0, false, fmt.Errorf("import the care contracts: %w", err)
	}
	var imported seedContractImportAnswer
	if err := json.Unmarshal(raw, &imported); err != nil {
		return 0, false, fmt.Errorf("read the import of the care contracts: %w", err)
	}
	return preview.Data.Counts.Ready, true, seedCareContractCorrections(client, auth, imported)
}

// seedContractImportAnswer is what the seed reads of a look at an import
// file: the fingerprint, the counts and the contract of every row.
type seedContractImportAnswer struct {
	Data struct {
		Fingerprint string `json:"fingerprint"`
		Counts      struct {
			Ready     int `json:"ready"`
			Duplicate int `json:"duplicate"`
		} `json:"counts"`
		Rows []struct {
			Status         string   `json:"status"`
			ChildFirstName string   `json:"child_first_name"`
			ChildLastName  string   `json:"child_last_name"`
			ContractID     ident.ID `json:"contract_id"`
		} `json:"rows"`
	} `json:"data"`
}

// seedCorrections are what the original documents of the imported contracts
// prove (#7767), by the first name of the child: the parties, whether the
// contract was concluded online or on paper, the day of the conclusion and
// the document. Emil has none, so his contract stays as the import left it:
// on paper, the day unknown.
var seedCorrections = map[string][4]string{
	"Jonte": {"Petersen, Maren | Petersen, Nils", "online", "14.05.2026", "Vertrag Petersen vom 14.05.2026 (PDF)"},
	"Malia": {"", "online", "unbekannt", "Online-Anmeldung Okafor, ohne Datum"},
	"Ida":   {"Brandt, Katrin", "papier", "02.06.2026", "Papiervertrag Brandt, Ordner 2026"},
}

// seedCareContractCorrections completes the imported contracts from their
// original documents like the office: it previews the correction file and
// stores what the preview showed, so the demo shows a contract concluded
// online, one whose day nobody knows and the trail of a correction.
func seedCareContractCorrections(client *Client, auth AuthRef, imported seedContractImportAnswer) error {
	rows := []string{"Vertrag-ID;Kind;Vertragsparteien;Abschlussart;Abschlussdatum;Beleg"}
	for _, row := range imported.Data.Rows {
		correction, ok := seedCorrections[row.ChildFirstName]
		// Only a contract this run took over: one an earlier run stored may
		// carry corrections somebody made by hand since.
		if !ok || row.ContractID == 0 || row.Status != "imported" {
			continue
		}
		rows = append(rows, strings.Join([]string{fmt.Sprint(int64(row.ContractID)), row.ChildFirstName + " " + row.ChildLastName,
			correction[0], correction[1], correction[2], correction[3]}, ";"))
	}
	if len(rows) == 1 {
		return nil
	}
	csv := []byte(strings.Join(rows, "\r\n") + "\r\n")
	const file = "vertragsangaben-nachpflegen.csv"
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/contract-corrections/preview", "file", file, csv, nil)
	if err != nil {
		return fmt.Errorf("preview the correction of the imported contracts: %w", err)
	}
	var preview struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
			Counts      struct {
				Change  int `json:"change"`
				Invalid int `json:"invalid"`
			} `json:"counts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &preview); err != nil {
		return fmt.Errorf("read the preview of the contract correction: %w", err)
	}
	if preview.Data.Counts.Invalid > 0 {
		return fmt.Errorf("the correction of the imported contracts has %d invalid rows", preview.Data.Counts.Invalid)
	}
	if preview.Data.Counts.Change == 0 {
		return nil
	}
	if _, err := client.PostFileWithAuthFields(auth, "/traeger/contract-corrections/", "file", file, csv,
		map[string]string{"fingerprint": preview.Data.Fingerprint}); err != nil {
		return fmt.Errorf("correct the imported contracts: %w", err)
	}
	return nil
}
