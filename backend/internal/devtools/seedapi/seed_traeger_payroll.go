package api

import (
	"encoding/json"
	"fmt"
	"maps"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerPayrollValues are the Träger values of the payroll file of the
// demo Träger (#4712): an invented DATEV client of its Lohnbüro and invented
// Lohnarten per kind of contract. Fortbildung stays without Lohnart, so the
// check of the Lohnexport page shows what a missing Lohnart does.
var seedTraegerPayrollValues = map[string]string{
	"traeger_payroll.datev_consultant_number":             "29098",
	"traeger_payroll.datev_client_number":                 "55004",
	"traeger_payroll.wage_type.regelarbeit.part_time":     "1000",
	"traeger_payroll.wage_type.regelarbeit.full_time":     "1000",
	"traeger_payroll.wage_type.regelarbeit.minijob":       "1100",
	"traeger_payroll.wage_type.regelarbeit.uebungsleiter": "1200",
	"traeger_payroll.wage_type.regelarbeit.ehrenamt":      "1210",
	"traeger_payroll.wage_type.plus_stunden.part_time":    "1010",
	"traeger_payroll.wage_type.plus_stunden.full_time":    "1010",
	"traeger_payroll.wage_type.plus_stunden.minijob":      "1110",
	"traeger_payroll.wage_type.urlaub.part_time":          "1020",
	"traeger_payroll.wage_type.urlaub.full_time":          "1020",
	"traeger_payroll.wage_type.urlaub.minijob":            "1120",
	"traeger_payroll.wage_type.krank.part_time":           "1030",
	"traeger_payroll.wage_type.krank.full_time":           "1030",
	"traeger_payroll.wage_type.krank.minijob":             "1130",
	"traeger_payroll.unit.urlaub":                         "tage",
	"traeger_payroll.unit.krank":                          "tage",
}

// seedTraegerPayroll enters the payroll values with the right Personal and
// reads the check of last month's payroll file, which proves the route of
// the Lohnexport page. It returns the number of contracts the check counts.
func seedTraegerPayroll(client *Client, auth AuthRef, year, month int) (int, error) {
	for key, value := range seedTraegerPayrollValues {
		if _, err := client.PutWithAuth(auth, "/traeger/settings/values/"+key, map[string]any{"value": value}); err != nil {
			return 0, fmt.Errorf("set the payroll value %s: %w", key, err)
		}
	}
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/staff-exports/payroll?year=%d&month=%d&format=datev_lodas", year, month))
	if err != nil {
		return 0, fmt.Errorf("read the check of the payroll file: %w", err)
	}
	var envelope struct {
		Data struct {
			Contracts int `json:"contracts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return 0, fmt.Errorf("decode the check of the payroll file: %w", err)
	}
	return envelope.Data.Contracts, nil
}

// seedTraegerPayrollEmployerValues are the invented payroll values of every
// body that employs the staff of a demo school (#8041, ADR 0320): the Lohnbüro
// of the Träger keeps the Gemeinde as its own DATEV client, and the
// Kostenstelle marks its lines in the one file of the Träger.
var seedTraegerPayrollEmployerValues = map[string]any{"consultant_number": "29098", "client_number": "55005", "cost_center": "4711"}

// seedTraegerEmployerNumber is the invented personnel number a person has
// with the Gemeinde, another one than the Träger's.
const seedTraegerEmployerNumber = "9001"

// seedTraegerPayrollEmployers enters the payroll values of every body that
// employs at a school of the Träger, as the Lohnexport page does, and gives
// the first record with an Einsatzort there its own number with that body.
// It returns how many bodies it filled in.
func seedTraegerPayrollEmployers(client *Client, auth AuthRef, records []int64) (int, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/staff-exports/payroll/employers")
	if err != nil {
		return 0, fmt.Errorf("read the employers of the payroll file: %w", err)
	}
	var list struct {
		Data struct {
			Employers []struct {
				SchoolID ident.ID `json:"school_id"`
				Body     string   `json:"body"`
				Version  string   `json:"version"`
			} `json:"employers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return 0, fmt.Errorf("decode the employers of the payroll file: %w", err)
	}
	for _, employer := range list.Data.Employers {
		body := map[string]any{"body": employer.Body, "expected_version": employer.Version}
		maps.Copy(body, seedTraegerPayrollEmployerValues)
		if _, err := client.PutWithAuth(auth, fmt.Sprintf("/traeger/staff-exports/payroll/employers/%d", employer.SchoolID.Int64()), body); err != nil {
			return 0, fmt.Errorf("store the payroll values of the employer of school %d: %w", employer.SchoolID.Int64(), err)
		}
	}
	return len(list.Data.Employers), seedTraegerEmployerNumberOfFirst(client, auth, records)
}

// seedTraegerEmployerNumberOfFirst gives the first record with an
// Einsatzort another body employs at its own number there.
func seedTraegerEmployerNumberOfFirst(client *Client, auth AuthRef, records []int64) error {
	for _, recordID := range records {
		raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/staff-records/%d", recordID))
		if err != nil {
			return fmt.Errorf("read staff record %d: %w", recordID, err)
		}
		var detail struct {
			Data struct {
				Employments []struct {
					SchoolID     ident.ID `json:"school_id"`
					EmployerBody string   `json:"employer_body"`
					Version      string   `json:"employer_number_version"`
				} `json:"employments"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &detail); err != nil {
			return fmt.Errorf("decode staff record %d: %w", recordID, err)
		}
		for _, employment := range detail.Data.Employments {
			if employment.EmployerBody == "" {
				continue
			}
			path := fmt.Sprintf("/traeger/staff-records/%d/employer-numbers/%d", recordID, employment.SchoolID.Int64())
			_, err := client.PutWithAuth(auth, path, map[string]any{"employer_personnel_number": seedTraegerEmployerNumber, "expected_version": employment.Version})
			if err != nil {
				return fmt.Errorf("set the personnel number with the employer of record %d: %w", recordID, err)
			}
			return nil
		}
	}
	return nil
}
