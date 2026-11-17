package careplanhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	peopleModule "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/contact"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/departure"
)

// StudentWriteContracts registers the typed contract of the student create
// and update (ADR 0270), with patterns relative to the resource's mount. The
// answer is rendered by the projection the root binds as
// RespondCreatedStudent and RespondUpdatedStudent, so the root names its type.
func StudentWriteContracts(response any) []common.RouteContract {
	tenant := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/", Portals: tenant, Request: StudentRequest{}, Response: response, Enums: studentWriteEnums()},
		{Method: "PUT", Pattern: "/{id}", Portals: tenant, Request: UpdateStudentRequest{}, Response: response},
	}
}

// studentWriteEnums states the closed value sets of the two bodies. A
// guardian's role and language are free text and stay strings.
func studentWriteEnums() []common.EnumContract {
	return []common.EnumContract{
		{
			Type:   departure.DepartureMode(""),
			Values: []string{string(departure.DepartureAlone), string(departure.DepartureBus), string(departure.DeparturePickup), string(departure.DepartureAccompanied)},
		},
		{
			// Legacy input; a stored free text from before the departure plan
			// may be sent back unchanged.
			Name:   "PickupStatus",
			Fields: []string{"StudentRequest.pickup_status", "UpdateStudentRequest.pickup_status"},
			Values: []string{departure.PickupStatusPickedUp, departure.PickupStatusGoesAlone, departure.PickupStatusAccompanied},
		},
		{
			Name:   "GuardianRelationshipType",
			Fields: []string{"NewStudentGuardian.relationship_type"},
			Values: contact.RelationshipTypes(),
		},
		{
			Name:   "GuardianContactMethod",
			Fields: []string{"NewStudentGuardian.preferred_contact_method"},
			Values: contact.PreferredContactMethods(),
		},
		{
			Name:   "GuardianPhoneType",
			Fields: []string{"NewGuardianPhone.phone_type"},
			Values: []string{peopleModule.PhoneTypeMobile, peopleModule.PhoneTypeHome, peopleModule.PhoneTypeWork, peopleModule.PhoneTypeOther},
		},
	}
}
