package api

import "github.com/moto-ogs/project-phoenix/api/common"

// importTemplateRouteContracts registers the import templates of the staff
// portal (#2352), relative to /api/import. Data Import's http role may not
// import the contract types; the root names them. Each template answers a
// CSV file, or an Excel file for ?format=xlsx.
func importTemplateRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	format := []common.QueryParam{{Name: "format", Kind: common.QueryString, Values: []string{"csv", "xlsx"}}}
	var routes []common.RouteContract
	for _, kind := range []string{"students", "teachers", "class-list-entries", "opening-balances"} {
		routes = append(routes, common.RouteContract{Method: "GET", Pattern: "/" + kind + "/template", Portals: portals, Query: format, File: true})
	}
	return routes
}
