package api

import (
	"context"
	"fmt"
)

// seedDayChangesTomorrowStep gives the preview on tomorrow (#7657) its own
// entries, so "Heute anders" shows something under "Morgen" on every dev
// machine: one child of Klasse 1b is reported sick for tomorrow (status
// sick), and two children of Klasse 4b are on a day outing tomorrow and come
// back at 12:30 (arrival exception "Ausflug: …", as the school portal writes
// it). Like the class trips of today it runs on every day, weekends
// included.
type seedDayChangesTomorrowStep struct{}

func (seedDayChangesTomorrowStep) Name() string { return "Seeding day changes of tomorrow" }

func (seedDayChangesTomorrowStep) Run(_ context.Context, rt *Runtime) error {
	if rt.FixedSeeder == nil {
		return fmt.Errorf("day changes of tomorrow: prerequisites not available")
	}
	tomorrow := todaySeedDate().AddDays(1).String()
	sick, outing := demoStudentsOfClass(rt, "Klasse 1b", 1), demoStudentsOfClass(rt, "Klasse 4b", 2)
	if len(sick) < 1 || len(outing) < 2 {
		return fmt.Errorf("day changes of tomorrow: demo children not available")
	}
	for _, studentID := range sick {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/students/%d/status-days", studentID), map[string]any{
			"status": "sick", "dates": []string{tomorrow},
		}); err != nil {
			return fmt.Errorf("seed sick report of tomorrow: %w", err)
		}
	}
	for _, studentID := range outing {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/students/%d/arrival-exceptions", studentID), map[string]any{
			"exception_date": tomorrow, "expected_arrival": "12:30", "reason": "Ausflug: Zoo",
		}); err != nil {
			return fmt.Errorf("seed day outing of tomorrow: %w", err)
		}
	}
	return nil
}
