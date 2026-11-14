package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The Abwesenheitsarten and Kontingente of the demo Träger (#4710), seeded
// through the routes the people use after the staff records exist: the
// Personalverwaltung creates two types (the schools' own types of the same
// name join them), gives one person an extra day, the school allows at most
// two Umwandlungstage per person, and a caregiver with a staff record asks
// for a Regenerationstag that waits for the Leitung. Several demo schools
// seed the same Träger; a type another school's run created is no error.

const (
	seedTraegerRegeneration = "Regenerationstag"
	seedTraegerConversion   = "Umwandlungstag"
	seedCodeAbsenceTypeName = "workforce.traeger_absence_type_name_taken"
)

type seedTraegerAbsenceType struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type seedSchoolAbsenceType struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	KeptByTraeger bool   `json:"kept_by_traeger"`
}

// seedTraegerAbsences seeds the types, one Kontingent, the school's
// deviation and one open request.
func seedTraegerAbsences(ctx context.Context, rt *Runtime, auth AuthRef) error {
	types, err := seedTraegerAbsenceTypes(rt.Client, auth)
	if err != nil {
		return err
	}
	records, err := seedTraegerStaffRecordsOf(rt.Client, auth, rt.Bootstrap.SchoolID)
	if err != nil {
		return err
	}
	if len(records) > 0 {
		path := fmt.Sprintf("/traeger/staff-records/%d/absence-accounts/%d", records[0].ID, types[seedTraegerRegeneration])
		body := map[string]any{"year": time.Now().Year(), "entitled_days": 3, "reason": "Ein Tag mehr laut Vereinbarung"}
		if _, err := rt.Client.PutWithAuth(auth, path, body); err != nil {
			return fmt.Errorf("set a Kontingent of a Träger staff record: %w", err)
		}
	}
	schoolTypes, err := seedSchoolAbsenceTypes(rt)
	if err != nil {
		return err
	}
	if conversion, ok := schoolTypes[seedTraegerConversion]; ok {
		if _, err := rt.Client.PutWithAuth(rt.TenantAuth, "/api/absence-types/"+conversion, map[string]any{"school_limit_days": 2}); err != nil {
			return fmt.Errorf("deviate from a type of the Träger: %w", err)
		}
	}
	if err := seedTraegerConversionBooking(rt, records, schoolTypes[seedTraegerConversion]); err != nil {
		return err
	}
	requested, err := seedTraegerAbsenceRequest(ctx, rt, records, schoolTypes[seedTraegerRegeneration])
	if err != nil {
		return err
	}
	fmt.Printf("  Träger absence types: %d, open requests: %d\n", len(types), requested)
	return nil
}

// seedTraegerAbsenceTypes creates both types unless another school's run did
// and returns their IDs by name.
func seedTraegerAbsenceTypes(client *Client, auth AuthRef) (map[string]int64, error) {
	for _, body := range []map[string]any{
		{"name": seedTraegerRegeneration, "allowance_enabled": true, "standard_days": 2, "requestable": true},
		{"name": seedTraegerConversion, "allowance_enabled": true, "standard_days": 3, "carryover_until": "03-31"},
	} {
		_, err := client.PostWithAuth(auth, "/traeger/absence-types/", body)
		var refused *APIError
		if errors.As(err, &refused) && refused.Code == seedCodeAbsenceTypeName {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("create an absence type of the Träger: %w", err)
		}
	}
	raw, err := client.GetWithAuth(auth, "/traeger/absence-types/")
	if err != nil {
		return nil, fmt.Errorf("read the absence types of the Träger: %w", err)
	}
	var envelope struct {
		Data struct {
			Types []seedTraegerAbsenceType `json:"types"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode the absence types of the Träger: %w", err)
	}
	ids := map[string]int64{}
	for _, value := range envelope.Data.Types {
		ids[value.Name] = value.ID
	}
	if ids[seedTraegerRegeneration] == 0 || ids[seedTraegerConversion] == 0 {
		return nil, errors.New("the absence types of the Träger are missing after the seed")
	}
	return ids, nil
}

type seedTraegerStaffRecord struct {
	ID          int64  `json:"id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	Employments []struct {
		SchoolID int64 `json:"school_id"`
		StaffID  int64 `json:"staff_id"`
		Active   bool  `json:"active"`
	} `json:"employments"`
}

// seedTraegerStaffRecordsOf returns the records with a live employment at
// schoolID.
func seedTraegerStaffRecordsOf(client *Client, auth AuthRef, schoolID int64) ([]seedTraegerStaffRecord, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/staff-records/")
	if err != nil {
		return nil, fmt.Errorf("read the Träger staff records: %w", err)
	}
	var envelope struct {
		Data struct {
			Records []seedTraegerStaffRecord `json:"records"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode the Träger staff records: %w", err)
	}
	var result []seedTraegerStaffRecord
	for _, record := range envelope.Data.Records {
		for _, employment := range record.Employments {
			if employment.SchoolID == schoolID && employment.Active {
				result = append(result, record)
				break
			}
		}
	}
	return result, nil
}

// seedSchoolAbsenceTypes returns the school's rows of the Träger's types by
// name, as its Leitung reads them.
func seedSchoolAbsenceTypes(rt *Runtime) (map[string]string, error) {
	raw, err := rt.Client.GetWithAuth(rt.TenantAuth, "/api/absence-types")
	if err != nil {
		return nil, fmt.Errorf("read the absence types of the school: %w", err)
	}
	var envelope struct {
		Data []seedSchoolAbsenceType `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode the absence types of the school: %w", err)
	}
	ids := map[string]string{}
	for _, value := range envelope.Data {
		if value.KeptByTraeger {
			ids[value.Name] = value.ID
		}
	}
	return ids, nil
}

// seedTraegerAbsenceRequest signs in a caregiver of the school who has a
// staff record and asks for a Regenerationstag in three weeks.
func seedTraegerAbsenceRequest(ctx context.Context, rt *Runtime, records []seedTraegerStaffRecord, typeID string) (int, error) {
	if typeID == "" || rt.FixedSeeder == nil {
		return 0, nil
	}
	names := map[string]bool{}
	for _, record := range records {
		names[strings.TrimSpace(record.FirstName+" "+record.LastName)] = true
	}
	for _, staff := range rt.FixedSeeder.staffCredentials {
		if !names[staff.Name] {
			continue
		}
		auth, err := rt.Adapter.LoginTenant(ctx, staff.Email, staff.Password, rt.Bootstrap.TenantSlug)
		if err != nil {
			return 0, fmt.Errorf("sign in a caregiver for an absence request: %w", err)
		}
		day := seedNextWeekday(time.Now().AddDate(0, 0, 21))
		if _, err := rt.Client.PostWithAuth(auth, "/api/time-tracking/absences", map[string]any{
			"absence_type": "other", "absence_type_id": typeID, "note": "Regenerationstag nach dem Sommerfest",
			"date_start": day.Format("2006-01-02"), "date_end": day.Format("2006-01-02"),
		}); err != nil {
			return 0, fmt.Errorf("request a Regenerationstag: %w", err)
		}
		return 1, nil
	}
	return 0, nil
}

func seedNextWeekday(day time.Time) time.Time {
	for day.Weekday() == time.Saturday || day.Weekday() == time.Sunday {
		day = day.AddDate(0, 0, 1)
	}
	return day
}

// seedTraegerConversionBooking books an Umwandlungstag three weeks ago for
// the person who works at most schools, as the Leitung of this school does,
// so the Kontingent of the Personalakte shows a booking.
func seedTraegerConversionBooking(rt *Runtime, records []seedTraegerStaffRecord, typeID string) error {
	if typeID == "" || len(records) == 0 {
		return nil
	}
	chosen := records[0]
	for _, record := range records {
		if len(record.Employments) > len(chosen.Employments) {
			chosen = record
		}
	}
	id, err := strconv.ParseInt(typeID, 10, 64)
	if err != nil {
		return fmt.Errorf("parse the school's Umwandlungstag: %w", err)
	}
	for _, employment := range chosen.Employments {
		if employment.SchoolID != rt.Bootstrap.SchoolID {
			continue
		}
		day := seedNextWeekday(time.Now().AddDate(0, 0, -21))
		if err := postStaffAbsence(rt, employment.StaffID, day, "other", "Umwandlung Überstunden", &id); err != nil {
			return fmt.Errorf("book an Umwandlungstag: %w", err)
		}
	}
	return nil
}
