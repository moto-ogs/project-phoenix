package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	apiCommon "github.com/moto-ogs/project-phoenix/api/common"
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
	if err := replaceMealDays(rt, day, dishes); err != nil {
		return fmt.Errorf("change meal plan %s: %w", day, err)
	}
	fmt.Printf("  meal plan of %s changed; the families with lunch booked that day are told\n", day)
	if err := seedMealCancellation(rt, monday.AddDays(10)); err != nil {
		return err
	}
	return seedTodaysMenuChange(rt, todaySeedDate())
}

// seedMealCancellation cancels lunch on Thursday next week (#7656): the
// meal plan shows „Essen fällt aus“ with the reason, the kitchen list of the
// day is empty. A closing day there is closed anyway and keeps no
// cancellation.
func seedMealCancellation(rt *Runtime, day seedDate) error {
	_, err := rt.Client.Put("/api/meal-plan/days/"+day.String()+"/cancellation", map[string]any{"reason": "Der Caterer liefert an diesem Tag nicht."})
	var refused *APIError
	if errors.As(err, &refused) && refused.Code == apiCommon.CodeMealsDayClosed {
		fmt.Printf("  %s is a closing day; no lunch to cancel\n", day)
		return nil
	}
	if err != nil {
		return fmt.Errorf("cancel lunch on %s: %w", day, err)
	}
	fmt.Printf("  lunch on %s cancelled; the meal plan shows the reason\n", day)
	return nil
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
	if err := replaceMealDays(rt, today, dishes); err != nil {
		return fmt.Errorf("change today's meal plan %s: %w", today, err)
	}
	fmt.Printf("  meal plan of today (%s) changed; „Heute anders“ shows it\n", today)
	return nil
}
