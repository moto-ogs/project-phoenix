package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	settingsHTTP "github.com/moto-ogs/project-phoenix/modules/settings/http"
	configModel "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// HomeLayoutResponse is the JSON of the start page view the settings
// platform answers through GET /api/settings/home-layout (#2180): the
// person's deviations and arrangement and the school's prescriptions.
type HomeLayoutResponse struct {
	Overrides         map[string]bool                    `json:"overrides"`
	Blocks            []configModel.HomeBlockPlacement   `json:"blocks"`
	Policies          map[string]configModel.BlockPolicy `json:"policies"`
	CanManagePolicies bool                               `json:"can_manage_policies"`
}

// settingsRouteContracts registers the settings routes the staff portal
// reaches through its proxy, with patterns relative to /api/settings. The
// handlers answer the settings platform's values as they come, so the root
// names their types.
func settingsRouteContracts() []common.RouteContract {
	types := settingsHTTP.RouteContractTypes()
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/payroll-status", Portals: portals, Response: configModel.PayrollStatus{}},
		{Method: "GET", Pattern: "/device-pin-status", Portals: portals, Response: configModel.DevicePINStatus{}},
		{Method: "GET", Pattern: "/school-contact-email", Portals: portals, Response: types.SchoolContactEmail},
		{Method: "GET", Pattern: "/home-layout", Portals: portals, Response: HomeLayoutResponse{}},
		{Method: "PUT", Pattern: "/home-layout", Portals: portals, Request: types.HomeLayout, NoData: true},
		{Method: "DELETE", Pattern: "/home-layout", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/home-layout/policies", Portals: portals, Request: types.HomeBlockPolicies, NoData: true},
	}
}
