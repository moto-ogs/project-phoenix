package application

import (
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// storedDish is the canonical form of one dish in a day's version: the dish,
// its note ("" without one) and its allergen codes (never null), in the
// order of the day.
type storedDish struct {
	Dish      string   `json:"dish"`
	Note      string   `json:"note"`
	Allergens []string `json:"allergens"`
}

// dayVersion is the read-state token of a day's dishes (ADR 0311). The week
// read, the check of a save and the answer of a save all pass the dishes in
// stored form through it: storedDishes for what the store returns,
// normalizeDishes for what a save writes.
func dayVersion(dishes []mealplan.Dish) string {
	canonical := make([]storedDish, 0, len(dishes))
	for _, dish := range dishes {
		allergens := make([]string, 0, len(dish.Allergens))
		for _, allergen := range dish.Allergens {
			allergens = append(allergens, string(allergen))
		}
		canonical = append(canonical, storedDish{Dish: dish.Dish, Note: optionalText(dish.Note), Allergens: allergens})
	}
	return readstate.Fingerprint(canonical)
}

// storedDishes are the entries of one day as dishes, in position order.
func storedDishes(entries []domain.Entry) []mealplan.Dish {
	dishes := make([]mealplan.Dish, 0, len(entries))
	for _, entry := range entries {
		dishes = append(dishes, mealplan.Dish{Dish: entry.Dish, Note: entry.Note, Allergens: storedAllergens(entry.Allergens)})
	}
	return dishes
}

func optionalText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// storedSchedule is the canonical form of one period of a child's regular
// days in a schedule's version.
type storedSchedule struct {
	EffectiveFrom string           `json:"effective_from"`
	Weekdays      []domain.Weekday `json:"weekdays"`
}

// scheduleVersion is the read-state token of every period of a child's
// regular days (ADR 0311), in the order the store reads them. A save
// replaces the period in force on its day and drops every later one, so a
// change of any of them changes what the save overwrites.
func scheduleVersion(schedules []domain.ParticipationSchedule) string {
	canonical := make([]storedSchedule, 0, len(schedules))
	for _, schedule := range schedules {
		weekdays := append(make([]domain.Weekday, 0, len(schedule.Weekdays)), schedule.Weekdays...)
		canonical = append(canonical, storedSchedule{EffectiveFrom: schedule.EffectiveFrom.String(), Weekdays: weekdays})
	}
	return readstate.Fingerprint(canonical)
}
