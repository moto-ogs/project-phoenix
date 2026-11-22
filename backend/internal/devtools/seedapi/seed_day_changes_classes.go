package api

import (
	"context"
	"fmt"
)

// seedDayChangesClassesStep puts two classes on a trip today, so "Heute
// anders" shows its class entries on every dev machine (#7681): three
// children of Klasse 3b are away the whole day (status class_trip), two of
// Klasse 2b are on a day outing and come back at 13:00 (arrival exception
// "Ausflug: …", as the school portal writes it). It runs on every day,
// weekends included, so the overview is never empty for these entries.
type seedDayChangesClassesStep struct{}

func (seedDayChangesClassesStep) Name() string { return "Seeding class trips of today" }

func (seedDayChangesClassesStep) Run(_ context.Context, rt *Runtime) error {
	if rt.FixedSeeder == nil {
		return fmt.Errorf("class trip prerequisites not available")
	}
	today := todaySeedDate().String()
	trip, outing := demoStudentsOfClass(rt, "Klasse 3b", 3), demoStudentsOfClass(rt, "Klasse 2b", 2)
	if len(trip) < 3 || len(outing) < 2 {
		return fmt.Errorf("class trip demo children not available")
	}
	for _, studentID := range trip {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/students/%d/status-days", studentID), map[string]any{
			"status": "class_trip", "dates": []string{today},
		}); err != nil {
			return fmt.Errorf("seed class trip status day: %w", err)
		}
	}
	for _, studentID := range outing {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/students/%d/arrival-exceptions", studentID), map[string]any{
			"exception_date": today, "expected_arrival": "13:00", "reason": "Ausflug: Stadtpark",
		}); err != nil {
			return fmt.Errorf("seed day outing: %w", err)
		}
	}
	return nil
}

// demoStudentsOfClass returns up to n seeded children of a class, from the
// end of the demo list, away from the children other steps vary.
func demoStudentsOfClass(rt *Runtime, class string, n int) []int64 {
	ids := []int64{}
	for index := len(DemoStudents) - 1; index >= 0 && len(ids) < n; index-- {
		if DemoStudents[index].Class != class {
			continue
		}
		if id := rt.FixedSeeder.studentIDByIndex[index]; id != 0 {
			ids = append(ids, id)
		}
	}
	return ids
}
