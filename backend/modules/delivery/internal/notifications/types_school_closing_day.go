package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The notices about a closing day of the school (#7144).
const (
	// TypeSchoolClosingDayChanged tells every account of the school in the
	// OGS portal and in moto schule that a closing day was planned, changed
	// or cancelled. It writes the notification feed and pushes while the
	// change takes effect within 14 days.
	TypeSchoolClosingDayChanged = contract.NotificationSchoolClosingDayChanged
	// TypeParentSchoolClosingDayChanged tells the families of the school the
	// same. It follows the school switch of TypeSchoolClosingDayChanged.
	TypeParentSchoolClosingDayChanged = contract.NotificationParentSchoolClosingDayChanged
)

// registerSchoolClosingDayTypes registers the notices about a closing day
// (#7144). They write the notification feed; the person's switch decides
// only the push, which is on until the person switches it off. The staff
// type follows the right every staff role holds, the guest included, and in
// moto schule reaches every account: the whole school closes.
func registerSchoolClosingDayTypes() {
	RegisterType(TypeDefinition{
		Key:                           TypeSchoolClosingDayChanged,
		Label:                         "Schließtage",
		Description:                   "Wenn ein Schließtag eingetragen, geändert oder gelöscht wird. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Schließtagen in den nächsten 14 Tagen.",
		Group:                         GroupAppointments,
		Portal:                        PortalStaff,
		TenantGate:                    settingSchoolClosingDayEnabled,
		SortOrder:                     3,
		Permission:                    permissionActivitiesRead,
		DefaultOn:                     true,
		SchoolPortal:                  true,
		SchoolPortalWithoutPermission: true,
		Feed:                          true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeParentSchoolClosingDayChanged,
		Label:       "Schließtage",
		Description: "Wenn die Schule einen Schließtag einträgt, ändert oder löscht. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Schließtagen in den nächsten 14 Tagen.",
		Group:       GroupAppointments,
		Portal:      PortalParent,
		TenantGate:  settingSchoolClosingDayEnabled,
		SortOrder:   4,
		DefaultOn:   true,
		Feed:        true,
	})
}
