package schoolsetuphttp

// ContractTypes are the request bodies of the wizard and of the first steps
// (ADR 0270). This http role may not import the contract types, so the root
// builds the registrations from these.
type ContractTypes struct {
	Skip, Dismissal, StepState any
}

// RouteContractTypes names the request bodies of both route groups.
func RouteContractTypes() ContractTypes {
	return ContractTypes{Skip: skipRequest{}, Dismissal: dismissalRequest{}, StepState: stepStateRequest{}}
}
