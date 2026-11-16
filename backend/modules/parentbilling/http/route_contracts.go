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
