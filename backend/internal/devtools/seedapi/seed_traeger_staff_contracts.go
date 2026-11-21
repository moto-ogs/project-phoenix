package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/demoprofile"
)

// The Arbeitsverträge of the demo records (#4706): every record the seed
// linked gets one contract since the start of the school year with a Soll at
// each Einsatzort; the first one also gets a higher Soll from next month on
// and the Ferien-Soll of the two Easter weeks at its first Einsatzort. A
// record another school's run gave a contract keeps it.

// seedTraegerContractStart is the first day of the seeded school year.
const seedTraegerContractStart = "2026-08-01"

// seedTraegerContractPatterns are the weekly Soll the contracts take in
// turn: kind and minutes Monday to Friday per Einsatzort.
var seedTraegerContractPatterns = []struct {
	kind    string
	minutes []int
}{
	{"part_time", []int{300, 300, 300, 300, 240}},
	{"full_time", []int{480, 480, 480, 480, 480}},
	{"part_time", []int{240, 240, 0, 240, 240}},
	{"minijob", []int{120, 0, 120, 0, 120}},
	// Übungsleiter and Ehrenamt (#4712): a training group twice a week and
	// a reading hour, each with its own Lohnarten in the payroll file.
	{"uebungsleiter", []int{90, 0, 90, 0, 0}},
	{"ehrenamt", []int{0, 60, 0, 0, 0}},
}

// seedTraegerPoolRecord marks the second and the fourth record as Springer
// of the Vertretungspool (#4709), so every school of the demo Träger sees
// two of them.
func seedTraegerPoolRecord(i int) bool { return i == 1 || i == 3 }

// seedTraegerEasterWeeks are the Easter holidays 2027 in NRW.
var seedTraegerEasterWeeks = [2]string{"2027-03-22", "2027-03-29"}

const seedCodeHolidayWeekSchoolOverride = "workforce.traeger_holiday_week_school_override"

type seedTraegerStaffRecord struct {
	Employments []struct {
		SchoolID demoprofile.ID `json:"school_id"`
		StaffID  demoprofile.ID `json:"staff_id"`
		Active   bool           `json:"active"`
	} `json:"employments"`
	Contracts []struct {
		ID demoprofile.ID `json:"id"`
	} `json:"contracts"`
}

func seedTraegerStaffContracts(client *Client, auth AuthRef, records []int64) (int, error) {
	created := 0
	for i, recordID := range records {
		made, err := seedTraegerStaffContract(client, auth, recordID, i)
		if err != nil {
			return 0, err
		}
		if made {
			created++
		}
	}
	return created, nil
}

// seedTraegerStaffContract enters the contract of the i-th record; the first
// one also gets its changes. It reports whether it entered one.
func seedTraegerStaffContract(client *Client, auth AuthRef, recordID int64, i int) (bool, error) {
	record, err := seedTraegerStaffRecordOf(client, auth, recordID)
	if err != nil || len(record.Contracts) > 0 {
		return false, err
	}
	pattern := seedTraegerContractPatterns[i%len(seedTraegerContractPatterns)]
	sites := make([]map[string]any, 0, len(record.Employments))
	for _, employment := range record.Employments {
		if employment.Active {
			sites = append(sites, map[string]any{"school_id": employment.SchoolID, "staff_id": employment.StaffID, "weekday_minutes": pattern.minutes})
		}
	}
	if len(sites) == 0 {
		return false, nil
	}
	raw, err := client.PostWithAuth(auth, fmt.Sprintf("/traeger/staff-records/%d/contracts", recordID), map[string]any{
		"kind": pattern.kind, "starts_on": seedTraegerContractStart, "sites": sites, "pool": seedTraegerPoolRecord(i),
	})
	if err != nil {
		return false, fmt.Errorf("enter a contract of a Träger staff record: %w", err)
	}
	if i > 0 {
		return true, nil
	}
	return true, seedTraegerContractChanges(client, auth, recordID, raw, sites[0])
}

func seedTraegerStaffRecordOf(client *Client, auth AuthRef, recordID int64) (seedTraegerStaffRecord, error) {
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("/traeger/staff-records/%d", recordID))
	if err != nil {
		return seedTraegerStaffRecord{}, fmt.Errorf("read a Träger staff record: %w", err)
	}
	var envelope struct {
		Data seedTraegerStaffRecord `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return seedTraegerStaffRecord{}, fmt.Errorf("decode a Träger staff record: %w", err)
	}
	return envelope.Data, nil
}

// seedTraegerContractChanges raises the Soll of the first Einsatzort from
// the first of next month on and enters the Easter weeks there.
func seedTraegerContractChanges(client *Client, auth AuthRef, recordID int64, created []byte, site map[string]any) error {
	var envelope struct {
		Data seedTraegerStaffRecord `json:"data"`
	}
	if err := json.Unmarshal(created, &envelope); err != nil || len(envelope.Data.Contracts) == 0 {
		return fmt.Errorf("decode a Träger contract: %w", errors.Join(err, errors.New("no contract")))
	}
	base := fmt.Sprintf("/traeger/staff-records/%d/contracts/%d", recordID, envelope.Data.Contracts[0].ID)
	now := time.Now()
	nextMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	raised := map[string]any{"school_id": site["school_id"], "staff_id": site["staff_id"], "weekday_minutes": []int{360, 360, 360, 360, 240}}
	if _, err := client.PostWithAuth(auth, base+"/soll", map[string]any{"valid_from": nextMonth, "sites": []map[string]any{raised}}); err != nil {
		return fmt.Errorf("raise the Soll of a Träger contract: %w", err)
	}
	_, err := client.PostWithAuth(auth, base+"/holiday-weeks", map[string]any{
		"school_id": site["school_id"], "staff_id": site["staff_id"], "from_week": seedTraegerEasterWeeks[0], "to_week": seedTraegerEasterWeeks[1],
		"weekday_minutes": []int{420, 420, 420, 420, 300},
	})
	var refused *APIError
	if errors.As(err, &refused) && refused.Code == seedCodeHolidayWeekSchoolOverride {
		return nil
	}
	if err != nil {
		return fmt.Errorf("enter the Ferien-Soll of a Träger contract: %w", err)
	}
	return nil
}
