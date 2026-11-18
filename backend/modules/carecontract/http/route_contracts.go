package carecontracthttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// ContractRouteContracts registers the typed contract of the care contracts
// (ADR 0270), with patterns relative to /traeger/contracts. The documents,
// the paper signature and the export answer files and keep their route files.
func ContractRouteContracts() []common.RouteContract {
	school := common.QueryParam{Name: "school_id", Kind: common.QueryID}
	list := []common.QueryParam{
		{Name: "status", Kind: common.QueryString}, school, {Name: "search", Kind: common.QueryString},
		{Name: "offset", Kind: common.QueryInt}, {Name: "limit", Kind: common.QueryInt},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: list, Response: carecontract.ContractList{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: CreateRequest{}, Response: carecontract.CreateResult{}},
		{Method: "GET", Pattern: "/candidates", Portals: traegerPortal, Query: []common.QueryParam{school}, Response: []carecontract.Candidate{}},
		{Method: "GET", Pattern: "/conclusion-modes", Portals: traegerPortal, Response: []carecontract.SchoolConclusion{}},
		{Method: "POST", Pattern: "/send", Portals: traegerPortal, Request: SendRequest{}, Response: carecontract.SendResult{}},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: carecontract.ContractDetail{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, NoData: true},
	}
}

// TemplateRouteContracts registers the contract templates of the offerings,
// with patterns relative to /traeger/contract-templates.
func TemplateRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []carecontract.OfferingTemplate{}},
		{Method: "PUT", Pattern: "/{schoolId}/{offeringId}", Portals: traegerPortal, Request: ContractTemplateRequest{}, Response: carecontract.OfferingTemplate{}},
	}
}

// NoticeRouteContracts registers withdrawal and termination, with patterns
// relative to /traeger/contract-notices.
func NoticeRouteContracts() []common.RouteContract {
	received := []common.QueryParam{{Name: "received_on", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Query: received, Response: carecontract.NoticeOptions{}},
		{Method: "POST", Pattern: "/{id}", Portals: traegerPortal, Request: NoticeRequest{}, Response: carecontract.NoticeOptions{}},
		{Method: "PUT", Pattern: "/{id}/ends-on", Portals: traegerPortal, Request: NoticeEndRequest{}, Response: carecontract.NoticeOptions{}},
		{Method: "POST", Pattern: "/{id}/reason-rejection", Portals: traegerPortal, Request: ReasonRejectionRequest{}, Response: carecontract.NoticeOptions{}},
	}
}

// ChangeRouteContracts registers the parents' changes of the booked care,
// with patterns relative to /traeger/contract-changes.
func ChangeRouteContracts() []common.RouteContract {
	effective := []common.QueryParam{{Name: "effective_from", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Query: effective, Response: carecontract.ContractChanges{}},
		{Method: "POST", Pattern: "/{id}/requests/{requestId}/decide", Portals: traegerPortal, Request: ChangeDecisionRequest{}, Response: carecontract.ContractChanges{}},
	}
}

// OverrunRouteContracts registers the evaluation of the care time overruns,
// with patterns relative to /traeger/care-time-overruns. The exports answer
// files and keep their route files.
func OverrunRouteContracts() []common.RouteContract {
	window := []common.QueryParam{
		{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}, {Name: "school_id", Kind: common.QueryID},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: window, Response: carecontract.OverrunEvaluation{}},
		{Method: "GET", Pattern: "/children", Portals: traegerPortal, Query: window, Response: carecontract.OverrunEvaluation{}},
	}
}
