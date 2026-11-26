package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The notices about a changed opening time of the school (#8178).
const (
	// TypeOpeningChangeChanged tells the staff of the school in the OGS
	// portal that an opening change was entered, changed or deleted. It
	// writes the notification feed and pushes while the change takes effect
	// within 14 days.
	TypeOpeningChangeChanged = contract.NotificationOpeningChangeChanged
	// TypeParentOpeningChangeChanged tells the families of the school the
	// same. It follows the school switch of TypeOpeningChangeChanged.
	TypeParentOpeningChangeChanged = contract.NotificationParentOpeningChangeChanged
	// TypeTraegerOpeningChangeChanged tells the members of the school's
	// Träger in the bell of the Träger-Portal. It follows the school switch
	// of TypeOpeningChangeChanged and never pushes.
	TypeTraegerOpeningChangeChanged = contract.NotificationTraegerOpeningChangeChanged
)

// registerOpeningChangeTypes registers the notices about an opening change
// (#8178), on the pattern of the closing days: they write the notification
// feed, and the person's switch decides only the push, which is on until the
// person switches it off. The staff type follows the right every staff role
// holds.
func registerOpeningChangeTypes() {
	RegisterType(TypeDefinition{
		Key:         TypeOpeningChangeChanged,
		Label:       "Geänderte Öffnungszeit",
		Description: "Wenn eine geänderte Öffnungszeit eingetragen, geändert oder gelöscht wird. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Tagen in den nächsten 14 Tagen.",
		Group:       GroupAppointments,
		Portal:      PortalStaff,
		TenantGate:  settingOpeningChangeEnabled,
		SortOrder:   4,
		Permission:  permissionActivitiesRead,
		DefaultOn:   true,
		Feed:        true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeParentOpeningChangeChanged,
		Label:       "Geänderte Öffnungszeit",
		Description: "Wenn die Schule an einem Tag zu anderen Zeiten öffnet oder schließt. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Tagen in den nächsten 14 Tagen.",
		Group:       GroupAppointments,
		Portal:      PortalParent,
		TenantGate:  settingOpeningChangeEnabled,
		SortOrder:   5,
		DefaultOn:   true,
		Feed:        true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeTraegerOpeningChangeChanged,
		Label:       "Geänderte Öffnungszeit",
		Description: "Wenn eine Schule des Trägers eine geänderte Öffnungszeit einträgt, ändert oder löscht.",
		Group:       GroupAppointments,
		Portal:      PortalTraeger,
		TenantGate:  settingOpeningChangeEnabled,
		SortOrder:   4,
		Feed:        true,
	})
}
