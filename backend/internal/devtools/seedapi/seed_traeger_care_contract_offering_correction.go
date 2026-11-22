package api

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// seedTraegerCareContractOfferingCorrectionStep moves the bookings of one
// imported contract to another module of its school (#7764), so the demo
// shows a version from a correction. It runs right after the import; the
// other imported contracts stay as they are, so the screen still has
// something to correct by hand.
type seedTraegerCareContractOfferingCorrectionStep struct{}

func (seedTraegerCareContractOfferingCorrectionStep) Name() string {
	return "Correcting the modules of an imported Träger care contract"
}

func (seedTraegerCareContractOfferingCorrectionStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger offering correction seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	outcome, err := seedOfferingCorrection(rt.Client, auth, rt.Bootstrap.SchoolID)
	if err != nil {
		return err
	}
	fmt.Printf("  Träger offering correction: %s\n", outcome)
	return nil
}

// The child of the import file whose contract the seed corrects.
const (
	seedCorrectionFirstName = "Jonte"
	seedCorrectionLastName  = "Petersen"
	seedCorrectionFile      = "module-zuordnung.csv"
)

// seedImportedVersion is the first version of an imported contract: the
// modules the import booked per weekday.
type seedImportedVersion struct {
	Source   string `json:"source"`
	Services []struct {
		Weekday    string `json:"weekday"`
		ModuleName string `json:"module_name"`
	} `json:"services"`
}

// seedOfferingCorrection previews the file for the modules of the school in
// turn, like the office would, and corrects the contract with the first
// module the preview finds ready. The contract begins next month, so the
// correction from today holds from its first day. A repeated seed finds
// the contract corrected: its preview answers unchanged and nothing is
// stored.
func seedOfferingCorrection(client *Client, auth AuthRef, school int64) (string, error) {
	contract, imported, err := seedCorrectableContract(client, auth, school)
	if err != nil || contract == 0 {
		return "no imported contract to correct", err
	}
	modules, err := seedSchoolModules(client, auth, school)
	if err != nil {
		return "", err
	}
	day := calendar.TodayDate().String()
	tries := 0
	for _, module := range modules {
		if imported[module] != "" {
			continue
		}
		if tries++; tries > seedImportTries {
			break
		}
		csv := seedOfferingCorrectionFile(contract, imported, module)
		status, fingerprint, err := seedPreviewOfferingCorrection(client, auth, csv, day)
		switch {
		case err != nil:
			return "", err
		case status == "unchanged":
			return fmt.Sprintf("contract %d already books %s", contract, module), nil
		case status != "ready":
			continue
		}
		if _, err := client.PostFileWithAuthFields(auth, "/traeger/contract-imports/offering-corrections", "file", seedCorrectionFile, csv,
			map[string]string{"effective_from": day, "fingerprint": fingerprint}); err != nil {
			return "", fmt.Errorf("correct the modules of contract %d: %w", contract, err)
		}
		return fmt.Sprintf("contract %d moved to %s", contract, module), nil
	}
	return "no module of the school takes the bookings", nil
}

// seedCorrectableContract finds the imported contract of the child and the
// weekdays its import booked per module.
func seedCorrectableContract(client *Client, auth AuthRef, school int64) (int64, map[string]string, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/?school_id=%d&search=%s", school, url.QueryEscape(seedCorrectionLastName)))
	if err != nil {
		return 0, nil, fmt.Errorf("find the imported contract to correct: %w", err)
	}
	var list struct {
		Data struct {
			Contracts []struct {
				ID             apiID  `json:"id"`
				ChildFirstName string `json:"child_first_name"`
				ChildLastName  string `json:"child_last_name"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return 0, nil, fmt.Errorf("read the contracts to correct: %w", err)
	}
	for _, contract := range list.Data.Contracts {
		if contract.ChildFirstName != seedCorrectionFirstName || contract.ChildLastName != seedCorrectionLastName {
			continue
		}
		imported, err := seedImportedModules(client, auth, int64(contract.ID))
		if err != nil || imported != nil {
			return int64(contract.ID), imported, err
		}
	}
	return 0, nil, nil
}

// seedImportedModules reads the weekdays the import of the contract booked
// per module; nil for a contract no import stored.
func seedImportedModules(client *Client, auth AuthRef, contract int64) (map[string]string, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/contracts/%d", contract))
	if err != nil {
		return nil, fmt.Errorf("read contract %d: %w", contract, err)
	}
	var detail struct {
		Data struct {
			Versions []seedImportedVersion `json:"versions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &detail); err != nil {
		return nil, fmt.Errorf("read contract %d: %w", contract, err)
	}
	for _, version := range detail.Data.Versions {
		if version.Source != "import" {
			continue
		}
		imported := map[string]string{}
		for _, service := range version.Services {
			imported[service.ModuleName] = strings.TrimSpace(imported[service.ModuleName] + " " + service.Weekday)
		}
		return imported, nil
	}
	return nil, nil
}

// seedSchoolModules names the active modules of the school, each once.
func seedSchoolModules(client *Client, auth AuthRef, school int64) ([]string, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/contract-templates/")
	if err != nil {
		return nil, fmt.Errorf("read the modules for the correction: %w", err)
	}
	var templates struct {
		Data []struct {
			SchoolID     apiID  `json:"school_id"`
			OfferingName string `json:"offering_name"`
			Active       bool   `json:"active"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &templates); err != nil {
		return nil, fmt.Errorf("read the modules for the correction: %w", err)
	}
	modules := []string{}
	for _, offering := range templates.Data {
		if int64(offering.SchoolID) == school && offering.Active && !slices.Contains(modules, offering.OfferingName) {
			modules = append(modules, offering.OfferingName)
		}
	}
	return modules, nil
}

// seedOfferingCorrectionFile moves every booking the import made to the
// module: a row per imported module with its weekdays.
func seedOfferingCorrectionFile(contract int64, imported map[string]string, module string) []byte {
	rows := []string{"Vertrag;Wochentag;Bisheriges Angebot;Zielangebot"}
	for _, current := range slices.Sorted(maps.Keys(imported)) {
		rows = append(rows, strings.Join([]string{fmt.Sprint(contract), imported[current], current, module}, ";"))
	}
	return []byte(strings.Join(rows, "\r\n") + "\r\n")
}

// seedPreviewOfferingCorrection answers what the correction does with the
// contract of the file, and the fingerprint to apply it with.
func seedPreviewOfferingCorrection(client *Client, auth AuthRef, csv []byte, day string) (string, string, error) {
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/contract-imports/offering-corrections/preview", "file", seedCorrectionFile, csv,
		map[string]string{"effective_from": day})
	if err != nil {
		return "", "", fmt.Errorf("preview the offering correction: %w", err)
	}
	var preview struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
			Contracts   []struct {
				Status string `json:"status"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &preview); err != nil {
		return "", "", fmt.Errorf("read the preview of the offering correction: %w", err)
	}
	if len(preview.Data.Contracts) != 1 {
		return "", "", fmt.Errorf("the preview of the offering correction names %d contracts, not one", len(preview.Data.Contracts))
	}
	return preview.Data.Contracts[0].Status, preview.Data.Fingerprint, nil
}
