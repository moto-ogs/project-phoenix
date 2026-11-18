package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The notices in the bell of the caterer portal (#7147): what changes the
// quantities a kitchen plans for a school it supplies.
const (
	// TypeCatererMealPlanChanged tells the caterer of the school that the
	// menu of a day changed. It follows the school switch of
	// TypeMealPlanChanged and never pushes.
	TypeCatererMealPlanChanged = contract.NotificationCatererMealPlanChanged
	// TypeCatererSchoolClosingDayChanged tells the caterer of the school that
	// a closing day was planned, changed or cancelled. It follows the school
	// switch of TypeSchoolClosingDayChanged and never pushes.
	TypeCatererSchoolClosingDayChanged = contract.NotificationCatererSchoolClosingDayChanged
)

// registerCatererTypes registers the feed types of the caterer portal. No
// person decides them: the portal offers no preferences.
func registerCatererTypes() {
	RegisterType(TypeDefinition{
		Key:         TypeCatererMealPlanChanged,
		Label:       "Speiseplan geändert",
		Description: "Wenn eine belieferte Schule das Essen an einem Tag ändert.",
		Group:       GroupChildren,
		Portal:      PortalCaterer,
		TenantGate:  settingMealPlanChangedEnabled,
		SortOrder:   1,
		Feed:        true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeCatererSchoolClosingDayChanged,
		Label:       "Schließtage",
		Description: "Wenn eine belieferte Schule einen Schließtag einträgt, ändert oder löscht.",
		Group:       GroupAppointments,
		Portal:      PortalCaterer,
		TenantGate:  settingSchoolClosingDayEnabled,
		SortOrder:   2,
		Feed:        true,
	})
}
