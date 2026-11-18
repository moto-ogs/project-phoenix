package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The staff notices about who staffs a block, under the heading
// „Dienstplan und Vertretung“ (#7136, #7138).
const (
	// TypeStaffingChanged tells the people a substitution or another staffing
	// change is about (#7136): who substitutes and who is absent. It writes
	// the notification feed and pushes while the change takes effect within
	// 14 days.
	TypeStaffingChanged = contract.NotificationStaffingChanged
	// TypeGroupStaffingChanged tells the teachers of the OGS group of an
	// affected block about the same change (#7136).
	TypeGroupStaffingChanged = contract.NotificationGroupStaffingChanged
	// TypeTeamMemberAbsent tells the rest of the team of the affected OGS
	// groups that a colleague is not there or there again (#7138).
	TypeTeamMemberAbsent = contract.NotificationTeamMemberAbsent
)

// registerStaffingTypes registers the staff notices about substitutions and
// other changes to who staffs a block (#7136) and the absence of a colleague
// in the team (#7138), under their own heading. They also write the
// notification feed; the person's switch decides only the push. All follow
// the right every staff role holds, so the switch reaches everyone who can be
// planned for a block or lead a group.
func registerStaffingTypes() {
	RegisterType(TypeDefinition{
		Key:         TypeStaffingChanged,
		Label:       "Eigene Vertretung",
		Description: "Wenn du jemanden vertrittst, vertreten wirst oder an einem Tag als nicht da eingetragen bist. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Änderungen in den nächsten 14 Tagen.",
		Group:       GroupStaffing,
		Portal:      PortalStaff,
		TenantGate:  settingStaffingChangedEnabled,
		SortOrder:   1,
		Permission:  permissionActivitiesRead,
		DefaultOn:   true,
		Feed:        true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeGroupStaffingChanged,
		Label:       "Vertretung in deinen Gruppen",
		Description: "Wenn in einer Gruppe, der du zugeordnet bist, jemand nicht da ist oder vertreten wird. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Änderungen in den nächsten 14 Tagen.",
		Group:       GroupStaffing,
		Portal:      PortalStaff,
		TenantGate:  settingStaffingChangedEnabled,
		SortOrder:   2,
		Permission:  permissionActivitiesRead,
		DefaultOn:   true,
		Feed:        true,
	})
	RegisterType(TypeDefinition{
		Key:         TypeTeamMemberAbsent,
		Label:       "Ausfall im Team",
		Description: "Wenn in einer Gruppe, die dir übergeben wurde, jemand nicht da ist. Der Hinweis in moto kommt immer, die Mitteilung aufs Handy nur bei Änderungen in den nächsten 14 Tagen.",
		Group:       GroupStaffing,
		Portal:      PortalStaff,
		TenantGate:  settingStaffingChangedEnabled,
		SortOrder:   3,
		Permission:  permissionActivitiesRead,
		DefaultOn:   true,
		Feed:        true,
	})
}
