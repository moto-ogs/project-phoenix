package api

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The staff members of today's absences, as indices into DemoStaff: the third
// is ill, the fifth stands in for her, the seventh is on vacation until later
// this week, and the eighth is on a training that began two days ago. None
// of them is a Pädagogische Fachkraft, so the simulation, which clocks those
// in, never stamps an absent person (#3892).
const (
	sickTodayStaffIndex       = 2
	substituteTodayStaffIndex = 4
	vacationTodayStaffIndex   = 6
	trainingTodayStaffIndex   = 7
)

// The long absences of today give "Heute anders" its "bis" and "seit" rows
// (#7660): the vacation lasts four more days, the training began two days
// ago and ends today.
const (
	vacationTodayExtraDays = 4
	trainingTodayPastDays  = 2
)

// seedTodaysAbsencesStep makes today a day with a real substitution case: one
// colleague reports sick, which cancels her Dienst and marks her blocks
// absent (the #1843 cascade), and the Leitung covers the Frühbetreuung and the
// Essensausgabe with the colleague in the Frühdienst. Her afternoon block
// stays an open gap on the Vertretungsplan. Another colleague takes a
// vacation day the Leitung booked, without a Dienst today. It runs after the
// time-tracking history: the absences are priced against the schedules it
// writes, and after this week's shifts, which the sick report cancels.
type seedTodaysAbsencesStep struct{}

func (seedTodaysAbsencesStep) Name() string { return "Seeding today's absences and substitution" }

func (seedTodaysAbsencesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.FixedSeeder == nil {
		return fmt.Errorf("today's absences prerequisites not available")
	}
	return seedTodaysAbsences(rt, todaySeedDate())
}

func seedTodaysAbsences(rt *Runtime, today seedDate) error {
	staffIDs := orderedSeedStaffIDs(rt.FixedSeeder)
	if len(staffIDs) <= trainingTodayStaffIndex {
		return fmt.Errorf("today's absences need %d staff members, got %d", trainingTodayStaffIndex+1, len(staffIDs))
	}
	if today.Weekday() == time.Saturday || today.Weekday() == time.Sunday {
		fmt.Println("  weekend: no absences today")
		return nil
	}
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)

	if err := postStaffAbsenceRange(rt, staffIDs[vacationTodayStaffIndex], today, today.AddDays(vacationTodayExtraDays), "vacation", "Urlaub"); err != nil {
		return fmt.Errorf("seed today's vacation: %w", err)
	}
	if err := postStaffAbsenceRange(rt, staffIDs[trainingTodayStaffIndex], today.AddDays(-trainingTodayPastDays), today, "training", "Fortbildung"); err != nil {
		return fmt.Errorf("seed today's training: %w", err)
	}
	sickID := staffIDs[sickTodayStaffIndex]
	if err := postStaffAbsence(rt, sickID, today.UTCMidnight(), "sick", "Krankmeldung am Morgen telefonisch", nil); err != nil {
		return fmt.Errorf("seed today's sick report: %w", err)
	}
	covered, err := coveredSickBlocks(rt, today, sickID)
	if err != nil {
		return err
	}
	if len(covered) == 0 {
		fmt.Println("  1 vacation, 1 training and 1 sick report today, no block to cover")
		return nil
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/deviations", covered[0]), map[string]any{
		"substitutions": []map[string]any{{
			"absent_staff_id": ident.ID(sickID), "substitute_staff_id": ident.ID(staffIDs[substituteTodayStaffIndex]),
			"reason": "Vertretung wegen Krankheit", "instance_ids": ident.IDs(covered),
		}},
	}); err != nil {
		return fmt.Errorf("seed today's substitution: %w", err)
	}
	fmt.Printf("  1 vacation, 1 training and 1 sick report today, %d blocks covered\n", len(covered))
	return nil
}

// postStaffAbsenceRange reports an absence over several days.
func postStaffAbsenceRange(rt *Runtime, staffID int64, from, to seedDate, absenceType, note string) error {
	_, err := rt.Client.Post(fmt.Sprintf("/api/staff/%d/absences", staffID), map[string]any{
		"absence_type": absenceType, "date_start": from.String(), "date_end": to.String(), "note": note,
	})
	return err
}

// coveredSubstituteBlocks are the blocks of the ill colleague the stand-in
// takes over; both lie in the stand-in's Frühdienst.
var coveredSubstituteBlocks = []string{"Frühbetreuung", "Essensausgabe"}

// coveredSickBlocks returns today's Frühbetreuung and Essensausgabe the ill
// staff member was planned for, in the order the day lists them. A block that
// is already over is history the Vertretungsplan refuses to rewrite: a demo
// school seeds its day after its first tick, which completes the
// Frühbetreuung from 08:30 on and the Essensausgabe from 13:00 on.
func coveredSickBlocks(rt *Runtime, today seedDate, staffID int64) ([]int64, error) {
	raw, err := rt.Client.Get(fmt.Sprintf("/api/timetable/instances?from=%s&to=%s", today.String(), today.String()))
	if err != nil {
		return nil, fmt.Errorf("list today's planning instances: %w", err)
	}
	var envelope struct {
		Data struct {
			Instances []seedPlanningInstance `json:"instances"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("parse today's planning instances: %w", err)
	}
	var ids []int64
	for _, instance := range envelope.Data.Instances {
		if slices.Contains(coveredSubstituteBlocks, instance.Title) && !instanceIsOver(instance) && instancePlansStaff(instance, staffID) {
			ids = append(ids, int64(instance.ID))
		}
	}
	return ids, nil
}

func instancePlansStaff(instance seedPlanningInstance, staffID int64) bool {
	for _, staff := range instance.Staff {
		if int64(staff.StaffID) == staffID {
			return true
		}
	}
	return false
}

// instanceIsOver reports a completed or cancelled block.
func instanceIsOver(instance seedPlanningInstance) bool {
	return instance.Status == "completed" || instance.Status == "cancelled"
}
