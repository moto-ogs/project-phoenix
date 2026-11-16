package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The notices about a changed Stundenplan of a class (#7142).
const (
	// TypeClassTimetableChanged tells the staff of a class that its
	// Unterrichtsschluss changes. It writes the feed and pushes by default
	// while the change takes effect today or tomorrow.
	TypeClassTimetableChanged = contract.NotificationClassTimetableChanged
	// TypeClassTimetableChangedAhead is the staff's own choice to hear about
	// a change 2 to 14 days ahead on the phone too; off by default. No event
	// carries it: the entry is a TypeClassTimetableChanged.
	TypeClassTimetableChangedAhead = contract.NotificationClassTimetableChangedAhead
	// TypeParentClassTimetableChanged tells the families of the class.
	TypeParentClassTimetableChanged = contract.NotificationParentClassTimetableChanged
)

// registerClassTimetableTypes registers the notices about a changed
// Stundenplan of a class (#7142). All share the school switch; the person's
// switch decides only the push, the feed entry comes always. A Lehrkraft of
// the class reads it in moto schule, where she holds no OGS right.
func registerClassTimetableTypes() {
	RegisterType(TypeDefinition{
		Key:                           TypeClassTimetableChanged,
		Label:                         "Stundenplan Ihrer Klassen: heute und morgen",
		Description:                   "Wenn sich der Unterrichtsschluss einer Klasse, der Sie zugeordnet sind oder deren Kinder in Ihrer Gruppe sind, für heute oder morgen ändert. Der Hinweis in moto kommt immer.",
		Group:                         GroupChildren,
		Portal:                        PortalStaff,
		TenantGate:                    settingClassTimetableChangedEnabled,
		SortOrder:                     10,
		Permission:                    permissionActivitiesRead,
		DefaultOn:                     true,
		SchoolPortal:                  true,
		SchoolPortalWithoutPermission: true,
		Feed:                          true,
	})
	RegisterType(TypeDefinition{
		Key:                           TypeClassTimetableChangedAhead,
		Label:                         "Stundenplan Ihrer Klassen: spätere Tage",
		Description:                   "Mitteilung aufs Handy auch, wenn sich der Unterrichtsschluss einer Ihrer Klassen in 2 bis 14 Tagen ändert. Der Hinweis in moto kommt immer.",
		Group:                         GroupChildren,
		Portal:                        PortalStaff,
		TenantGate:                    settingClassTimetableChangedEnabled,
		SortOrder:                     11,
		Permission:                    permissionActivitiesRead,
		SchoolPortal:                  true,
		SchoolPortalWithoutPermission: true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeParentClassTimetableChanged,
		Label:       "Stundenplan der Klasse",
		Description: "Wenn sich der Unterrichtsschluss in der Klasse Ihres Kindes ändert. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy bei Änderungen in den nächsten 14 Tagen.",
		Group:       GroupChildren,
		Portal:      PortalParent,
		TenantGate:  settingClassTimetableChangedEnabled,
		SortOrder:   2,
		Feed:        true,
	})
}
