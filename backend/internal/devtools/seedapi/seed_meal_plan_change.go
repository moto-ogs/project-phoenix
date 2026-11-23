package api

import (
	"context"
	"fmt"
	"time"
)

// seedMealPlanChangeStep changes the menu of Tuesday next week after the
// first parent account booked lunch for its child (#7145): the families with
// a meal booked on that day find the change in the bell of the parents
// portal. Next week's menu exists from seedMealPlan, and the day lies ahead,
// so the change reaches the families. On a weekday it also changes today's
// menu: the staff start page shows it under „Heute anders“ (#7666).
type seedMealPlanChangeStep struct{}

func (seedMealPlanChangeStep) Name() string {
	return "Seeding a meal plan change the families hear about"
}

func (seedMealPlanChangeStep) Run(_ context.Context, rt *Runtime) error {
	monday := seedDate{Time: mostRecentWeekday(todaySeedDate().Time, time.Monday)}
	day := monday.AddDays(8)
	dishes := []map[string]any{
		{"dish": "Gemüsereis mit Rührei", "note": "Geändert: Der Fisch wurde nicht geliefert.", "allergens": []string{"eggs"}},
		{"dish": "Obst", "note": "Äpfel und Birnen"},
	}
	if _, err := rt.Client.Put("/api/meal-plan/"+day.String(), map[string]any{"dishes": dishes}); err != nil {
		return fmt.Errorf("change meal plan %s: %w", day, err)
	}
	fmt.Printf("  meal plan of %s changed; the families with lunch booked that day are told\n", day)
	return seedTodaysMenuChange(rt, todaySeedDate())
}

// seedTodaysMenuChange changes today's published menu, so „Heute anders“
// shows that the meal plan changed today (#7666). The meal plan has no
// weekend: on Saturday and Sunday there is nothing to change.
func seedTodaysMenuChange(rt *Runtime, today seedDate) error {
	if weekday := today.Weekday(); weekday == time.Saturday || weekday == time.Sunday {
		fmt.Println("  today is a weekend day; no menu of today to change")
		return nil
	}
	dishes := []map[string]any{
		{"dish": "Kartoffelpuffer mit Apfelmus", "note": "Geändert: Die Lieferung kam heute nicht.", "allergens": []string{"eggs", "gluten"}},
	}
	if _, err := rt.Client.Put("/api/meal-plan/"+today.String(), map[string]any{"dishes": dishes}); err != nil {
		return fmt.Errorf("change today's meal plan %s: %w", today, err)
	}
	fmt.Printf("  meal plan of today (%s) changed; „Heute anders“ shows it\n", today)
	return nil
}
