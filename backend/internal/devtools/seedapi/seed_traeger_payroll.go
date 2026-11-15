package api

import (
	"encoding/json"
	"fmt"
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
