package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"
)

// The Einsatzplanung of the demo Träger (#4708): next week every person with
// a second Einsatzort gets mornings from Wednesday to Friday at the one the
// schools planned least, next to the shifts of the other. The
// first such person also works a parents' evening on Monday at the second
// school: more than the daily maximum, planned with a reason. A person the
// Träger already planned for stays as it is; a refused shift is skipped.

// The refusals a seed shift may meet when the schools' own plans cover it.
const (
	seedCodeShiftOverlap          = "workforce.shift_overlap"
	seedCodeShiftDuplicate        = "workforce.shift_duplicate"
	seedCodeShiftOtherSite        = "workforce.shift_overlaps_other_site"
	seedCodeShiftWorkingTimeAlert = "workforce.shift_working_time_warning"
)

var seedPlanningSkips = map[string]bool{
	seedCodeShiftOverlap:          true,
	seedCodeShiftDuplicate:        true,
	seedCodeShiftOtherSite:        true,
	seedCodeShiftWorkingTimeAlert: true,
}

type seedPlanningPerson struct {
	RecordID apiID `json:"staff_record_id"`
	Sites    []struct {
		SchoolID apiID `json:"school_id"`
	} `json:"sites"`
	Shifts []struct {
		SchoolID         apiID `json:"school_id"`
		PlannedByTraeger bool  `json:"planned_by_traeger"`
	} `json:"shifts"`
}

type seedPlanningShift struct {
	school     int64
	day        int
	start, end string
	reason     string
}

func seedTraegerPlanning(client *Client, auth AuthRef) (int, error) {
	monday := seedNextMonday(time.Now())
	people, err := seedPlanningWeek(client, auth, monday)
	if err != nil {
		return 0, err
	}
	planned, evening := 0, true
	for _, person := range people {
		if len(person.Sites) < 2 || seedPlannedByTraeger(person) {
			continue
		}
		for _, shift := range seedPlanningShifts(seedQuietSite(person), evening) {
			made, err := seedPlanShift(client, auth, int64(person.RecordID), monday, shift)
			if err != nil {
				return 0, err
			}
			if made {
				planned++
			}
		}
		evening = false
	}
	return planned, nil
}

// seedQuietSite is the Einsatzort with the fewest shifts this week, so the
// Träger plans where the school has not.
func seedQuietSite(person seedPlanningPerson) int64 {
	counts := map[int64]int{}
	for _, shift := range person.Shifts {
		counts[int64(shift.SchoolID)]++
	}
	quiet := person.Sites[0].SchoolID
	for _, site := range person.Sites[1:] {
		if counts[int64(site.SchoolID)] < counts[int64(quiet)] {
			quiet = site.SchoolID
		}
	}
	return int64(quiet)
}

func seedPlannedByTraeger(person seedPlanningPerson) bool {
	for _, shift := range person.Shifts {
		if shift.PlannedByTraeger {
			return true
		}
	}
	return false
}

// seedPlanningShifts lists the mornings at the second Einsatzort and, for
// the first person, the Monday evening.
func seedPlanningShifts(school int64, evening bool) []seedPlanningShift {
	shifts := []seedPlanningShift{
		{school: school, day: 2, start: "08:00", end: "12:00"},
		{school: school, day: 3, start: "08:00", end: "12:00"},
		{school: school, day: 4, start: "08:00", end: "12:00"},
	}
	if evening {
		shifts = append(shifts, seedPlanningShift{school: school, day: 0, start: "18:00", end: "20:30", reason: "Elternabend der zweiten Schule; Ausgleich am Dienstag durch den späten Beginn."})
	}
	return shifts
}

// seedPlanShift plans one shift and reports whether it planned it.
func seedPlanShift(client *Client, auth AuthRef, recordID int64, monday time.Time, shift seedPlanningShift) (bool, error) {
	body := map[string]any{
		"school_id": strconv.FormatInt(shift.school, 10), "date": monday.AddDate(0, 0, shift.day).Format("2006-01-02"),
		"start_time": shift.start, "end_time": shift.end, "break_minutes": 0,
	}
	// The planner confirms the hints of the week; the parents' evening also
	// names its reason.
	body["working_time_confirmed"], body["working_time_reason"] = true, shift.reason
	_, err := client.PostWithAuth(auth, fmt.Sprintf("/traeger/staff-planning/records/%d/shifts", recordID), body)
	var refused *APIError
	if errors.As(err, &refused) && seedPlanningSkips[refused.Code] {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("plan a shift of a Träger staff record: %w", err)
	}
	return true, nil
}

func seedPlanningWeek(client *Client, auth AuthRef, monday time.Time) ([]seedPlanningPerson, error) {
	raw, err := client.GetWithAuth(auth, "/traeger/staff-planning/?week="+monday.Format("2006-01-02"))
	if err != nil {
		return nil, fmt.Errorf("read the Einsatzplanung of the Träger: %w", err)
	}
	var envelope struct {
		Data struct {
			People []seedPlanningPerson `json:"people"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode the Einsatzplanung of the Träger: %w", err)
	}
	return envelope.Data.People, nil
}

// seedNextMonday is the Monday after today.
func seedNextMonday(now time.Time) time.Time {
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	offset := (8 - int(day.Weekday())) % 7
	if offset == 0 {
		offset = 7
	}
	return day.AddDate(0, 0, offset)
}
