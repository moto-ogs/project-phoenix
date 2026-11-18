package api

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Show two people who share their week between the visitor's school and one
// of its neighbours. Their deployments are visible when the demo opens.
type seedDemoNeighbourPlanningStep struct{}

func (seedDemoNeighbourPlanningStep) Name() string { return "Seeding the cross-school Einsatzplanung" }

func (seedDemoNeighbourPlanningStep) Run(_ context.Context, rt *Runtime) error {
	if len(rt.demoNeighbourIDs) == 0 {
		return nil
	}
	if err := seedTraegerStaffRelease(rt); err != nil {
		return err
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	monday := calendar.TodayDate().StartOfISOWeek()
	for i, schoolID := range rt.demoNeighbourIDs {
		if err := seedNeighbourDeployment(rt, auth, monday.BerlinMidnight(), schoolID, i); err != nil {
			return err
		}
	}
	return nil
}

var neighbourStaff = []struct{ first, last, birthday string }{
	{"Nora", "Jansen", "1992-04-21"},
	{"Emil", "Karim", "1989-08-14"},
}

func seedNeighbourDeployment(rt *Runtime, auth AuthRef, monday time.Time, schoolID int64, index int) error {
	person := neighbourStaff[index]
	primary := rt.Bootstrap.SchoolID
	sites := []map[string]any{
		{"school_id": primary, "weekday_minutes": []int{150, 150, 0, 0, 0}},
		{"school_id": schoolID, "weekday_minutes": []int{0, 0, 150, 0, 150}},
	}
	raw, err := rt.Client.PostWithAuth(auth, "/traeger/staff-records/hire", map[string]any{
		"first_name": person.first, "last_name": person.last, "birthday": person.birthday,
		"personnel_number": fmt.Sprintf("82%d", schoolID), "confirm_duplicate": true,
		"contract": map[string]any{"kind": "part_time", "starts_on": monday.Format("2006-01-02")},
		"sites":    sites,
	})
	if err != nil {
		return fmt.Errorf("hire demo staff at school %d and its neighbour: %w", primary, err)
	}
	record, err := decodeSeedEntityID(raw)
	if err != nil {
		return err
	}
	for _, week := range []time.Time{monday, monday.AddDate(0, 0, 7)} {
		for _, slot := range []struct {
			school int64
			day    int
		}{{primary, 0}, {primary, 1}, {schoolID, 2}, {schoolID, 4}} {
			shift := seedPlanningShift{school: slot.school, day: slot.day, start: "12:30", end: "15:00"}
			if _, err := seedPlanShift(rt.Client, auth, record, week, shift); err != nil {
				return err
			}
		}
	}
	return nil
}
