package parentbillinghttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// BillingFamilyRouteContracts registers the typed contract of the billing
// families (ADR 0270), with patterns relative to the
// /traeger/billing-families mount.
func BillingFamilyRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/debtor-number-format",
			Portals:  []common.PortalScope{common.PortalTraeger},
			Response: debtorNumberSettings{},
			Enums: []common.EnumContract{{
				Name: "DebtorNumberScope", Fields: []string{"debtorNumberSettings.scope"},
				Values: []string{capability.DebtorNumberScopePayer, capability.DebtorNumberScopeChild},
			}},
		},
	}
}

// BelegRetentionRouteContracts registers the operator's view and changes of
// the Beleg retention of a Träger (ADR 0270, #2352), with patterns relative
// to the /operator/organizations/{id}/beleg-retention mount.
func BelegRetentionRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "", Portals: operator, Response: capability.BelegRetentionOverview{}},
		{Method: "POST", Pattern: "/instructions", Portals: operator, Request: instructionRequest{}, Response: capability.RetentionInstruction{}},
		{Method: "POST", Pattern: "/suspensions", Portals: operator, Request: suspensionRequest{}, Response: capability.RetentionSuspension{}},
		{Method: "DELETE", Pattern: "/suspensions/{suspensionId}", Portals: operator, NoData: true},
		{Method: "POST", Pattern: "/clarification-reviews", Portals: operator, Request: clarificationReviewRequest{}, Response: capability.BelegClarificationReview{}},
	}
}
