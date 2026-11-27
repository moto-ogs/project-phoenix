package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// TypeRoomClosed tells the staff planned in a room that the school closed it
// (#8234). It writes the notification feed and pushes while the closure
// begins within 14 days.
const TypeRoomClosed = contract.NotificationRoomClosed

// registerRoomClosureTypes registers the notice about a closed room, on the
// pattern of the room changes (#7141): the feed entry always comes, the
// person's switch decides only the push, which is on until the person
// switches it off. Only staff planned on a block in the room receive it, in
// the OGS portal; moto schule stays out like the opening change (#8172).
func registerRoomClosureTypes() {
	RegisterType(TypeDefinition{
		Key:         TypeRoomClosed,
		Label:       "Raum gesperrt",
		Description: "Wenn die Schule einen Raum sperrt, in dem du einen Termin hast. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur, wenn die Sperre in den nächsten 14 Tagen beginnt.",
		Group:       GroupAppointments,
		Portal:      PortalStaff,
		TenantGate:  settingRoomClosedEnabled,
		SortOrder:   5,
		Permission:  permissionActivitiesRead,
		DefaultOn:   true,
		Feed:        true,
	})
}
