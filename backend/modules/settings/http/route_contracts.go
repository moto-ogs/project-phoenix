package settingshttp

import "github.com/moto-ogs/project-phoenix/api/common"

// ContractTypes are the bodies of the settings routes the contract registers
// (ADR 0270) that this package owns. The answers of the settings platform
// travel as values this http role may not name, so the root names them.
type ContractTypes struct {
	SchoolContactEmail, HomeLayout, HomeBlockPolicies any
}

// RouteContractTypes names the bodies this package declares.
func RouteContractTypes() ContractTypes {
	return ContractTypes{
		SchoolContactEmail: schoolContactEmailResponse{},
		HomeLayout:         homeLayoutOverridesRequest{},
		HomeBlockPolicies:  homeBlockPoliciesRequest{},
	}
}

// RevealedValueResponse is the plain value of a secret setting
// (GET /api/settings/values/{key}/reveal); its form depends on the setting.
type RevealedValueResponse struct {
	Value any `json:"value" contract_json:"The revealed setting's registered kind determines its value type"`
}

// LegalAGBDocumentRouteContracts registers the upload and the removal of the
// school's AGB document (#2352), relative to /api/settings.
func LegalAGBDocumentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/enrollment/legal-agb-document", Portals: portals, Multipart: true,
			MaxBodyBytes: maxLegalAGBDocumentBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: legalAGBDocumentResponse{}},
		{Method: "DELETE", Pattern: "/enrollment/legal-agb-document", Portals: portals, NoData: true},
	}
}

// tenantCacheRouteFile is why the staff portal's route file serves a write
// that shows on the login page.
const tenantCacheRouteFile = "the route file purges the cached tenant lookup after the write, so the login page shows the change"

// RouteFileContracts registers the value writes and the login image of the
// settings page (#7808), relative to /api/settings. Their route files purge
// the cached tenant lookup after a write, so no proxy allowlist names them.
func RouteFileContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "PUT", Pattern: "/values/{key}", Portals: portals, RouteFile: tenantCacheRouteFile, Request: setValueRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/values/{key}", Portals: portals, RouteFile: tenantCacheRouteFile, NoData: true},
		{Method: "GET", Pattern: "/login-image", Portals: portals, RouteFile: "served by the same route file as its writes", Response: loginImageResponse{}},
		{Method: "POST", Pattern: "/login-image", Portals: portals, RouteFile: tenantCacheRouteFile, Multipart: true,
			MaxBodyBytes: maxLoginImageBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: loginImageUploadResponse{}},
		{Method: "DELETE", Pattern: "/login-image", Portals: portals, RouteFile: tenantCacheRouteFile, NoData: true},
	}
}
