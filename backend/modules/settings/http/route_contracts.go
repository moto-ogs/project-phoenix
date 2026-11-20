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
	Value any `json:"value"`
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
