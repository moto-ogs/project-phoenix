package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
)

// menuChangeMark is the mark a saved day carries for the staff (#7666): the
// instant of the save when a published menu changed, the earlier mark when
// the same menu is saved again, and none for a day as first published. The
// rule is the one of the families' notice (#7145): publishing the menu of an
// empty day is the regular weekly plan, not a change.
func menuChangeMark(before []domain.Entry, after []mealplan.Dish, now time.Time) *time.Time {
	if len(before) == 0 {
		return nil
	}
	if sameMenu(before, after) {
		return before[0].MenuChangedAt
	}
	changed := now
	return &changed
}
