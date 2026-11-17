package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The notices about an appointment or offering that moves to another room
// (#7141). The staff of the block's staffing and the families of its booked
// children hear about it. The day of the block decides the type: a move for
// today or tomorrow pushes unless the person switched it off; a move for a
// later day pushes within 14 days only for whoever switched that on, and
// reaches the feed only beyond. The feed entry always comes.
const (
	TypeInstanceRoomChanged      = contract.NotificationInstanceRoomChanged
	TypeInstanceRoomChangedLater = contract.NotificationInstanceRoomChangedLater
	TypeParentRoomChanged        = contract.NotificationParentRoomChanged
	TypeParentRoomChangedLater   = contract.NotificationParentRoomChangedLater
)

// registerRoomChangeTypes registers the four room notices. All share the
// school switch notifications.instance_room_changed_enabled. The staff types
// follow the right every staff role holds, like the cancellation: whoever can
// be planned for a block is offered them, and moto schule offers them to a
// Lehrkraft planned for one (#7139). The parent types are about the children
// of the entry; who reads them is decided by parent_portal.access.
func registerRoomChangeTypes() {
	RegisterType(TypeDefinition{
		Key:                           TypeInstanceRoomChanged,
		Label:                         "Raumänderung heute oder morgen",
		Description:                   "Wenn ein Termin, für den Sie eingeplant sind, heute oder morgen in einem anderen Raum stattfindet. Der Hinweis in moto kommt immer.",
		Group:                         GroupAppointments,
		Portal:                        PortalStaff,
		TenantGate:                    settingInstanceRoomChangedEnabled,
		SortOrder:                     3,
		Permission:                    permissionActivitiesRead,
		DefaultOn:                     true,
		SchoolPortal:                  true,
		SchoolPortalWithoutPermission: true,
		Feed:                          true,
	})
	RegisterType(TypeDefinition{
		Key:                           TypeInstanceRoomChangedLater,
		Label:                         "Raumänderung an späteren Tagen",
		Description:                   "Wenn ein Termin, für den Sie eingeplant sind, ab übermorgen in einem anderen Raum stattfindet. Der Hinweis in moto kommt immer. Die Mitteilung aufs Handy kommt nur, wenn Sie sie einschalten, und nur für die nächsten 14 Tage.",
		Group:                         GroupAppointments,
		Portal:                        PortalStaff,
		TenantGate:                    settingInstanceRoomChangedEnabled,
		SortOrder:                     4,
		Permission:                    permissionActivitiesRead,
		SchoolPortal:                  true,
		SchoolPortalWithoutPermission: true,
		Feed:                          true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeParentRoomChanged,
		Label:       "Raumänderung heute oder morgen",
		Description: "Wenn ein Termin Ihres Kindes heute oder morgen in einem anderen Raum stattfindet.",
		Group:       GroupAppointments,
		Portal:      PortalParent,
		TenantGate:  settingInstanceRoomChangedEnabled,
		SortOrder:   4,
		DefaultOn:   true,
		Feed:        true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeParentRoomChangedLater,
		Label:       "Raumänderung an späteren Tagen",
		Description: "Wenn ein Termin Ihres Kindes ab übermorgen in einem anderen Raum stattfindet. Die Mitteilung kommt nur, wenn Sie sie einschalten, und nur für die nächsten 14 Tage.",
		Group:       GroupAppointments,
		Portal:      PortalParent,
		TenantGate:  settingInstanceRoomChangedEnabled,
		SortOrder:   5,
		Feed:        true,
	})
}
