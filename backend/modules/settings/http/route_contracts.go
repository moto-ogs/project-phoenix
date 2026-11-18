package settingshttp

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
