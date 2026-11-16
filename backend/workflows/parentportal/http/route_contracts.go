package parent

import "github.com/moto-ogs/project-phoenix/api/common"

// Phase kinds and audiences as Enrollment stores them. The portal reads them
// through its own port and does not import Enrollment; the root's contract
// test compares them with the owner's values.
var (
	EnrollablePhaseKinds     = []string{"school_year", "holiday", "custom"}
	EnrollablePhaseAudiences = []string{"open", "new_students", "existing_students", "linked_parents"}
)

// MeRouteContracts registers the typed contract of the guardian's own reads
// (ADR 0270), with patterns relative to the /parent mount.
func MeRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/me/enrollable-schools",
			Portals:  []common.PortalScope{common.PortalParent},
			Response: []EnrollablePhaseResponse{},
			Enums: []common.EnumContract{
				{Name: "EnrollmentPhaseKind", Fields: []string{"EnrollablePhaseResponse.phase_kind"}, Values: EnrollablePhaseKinds},
				{Name: "EnrollmentPhaseAudience", Fields: []string{"EnrollablePhaseResponse.audience"}, Values: EnrollablePhaseAudiences},
			},
		},
	}
}
