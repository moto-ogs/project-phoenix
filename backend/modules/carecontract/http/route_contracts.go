package carecontracthttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// ContractRouteContracts registers the typed contract of the care contracts
// (ADR 0270), with patterns relative to /traeger/contracts. Documents and
// exports answer files; the paper signature also takes a multipart upload
// through the catalog (#2352).
func ContractRouteContracts() []common.RouteContract {
	school := common.QueryParam{Name: "school_id", Kind: common.QueryID}
	filter := []common.QueryParam{{Name: "status", Kind: common.QueryString}, school, {Name: "search", Kind: common.QueryString}}
	list := append([]common.QueryParam{{Name: "offset", Kind: common.QueryInt}, {Name: "limit", Kind: common.QueryInt}}, filter...)
	export := append([]common.QueryParam{common.ListFormatQuery}, filter...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: list, Response: carecontract.ContractList{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: export, File: true},
		{Method: "GET", Pattern: "/{id}/document", Portals: traegerPortal, File: true},
		{Method: "GET", Pattern: "/{id}/versions/{number}/document", Portals: traegerPortal, File: true},
		{Method: "GET", Pattern: "/{id}/paper-signature", Portals: traegerPortal, File: true},
		// The handler answers 204; the catalog proxy answers it as no data.
		{Method: "POST", Pattern: "/{id}/paper-signature", Portals: traegerPortal, Multipart: true,
			MaxBodyBytes: carecontract.PaperMaxBytes + paperFormOverhead, TooLargeCode: common.CodeCareContractPaperDocumentInvalid, NoData: true},
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
// files (#2352).
func OverrunRouteContracts() []common.RouteContract {
	window := []common.QueryParam{
		{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}, {Name: "school_id", Kind: common.QueryID},
	}
	export := append([]common.QueryParam{common.ListFormatQuery}, window...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: window, Response: carecontract.OverrunEvaluation{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: export, File: true},
		{Method: "GET", Pattern: "/children", Portals: traegerPortal, Query: window, Response: carecontract.OverrunEvaluation{}},
		{Method: "GET", Pattern: "/children/export", Portals: traegerPortal, Query: export, File: true},
	}
}

// ImportRouteContracts registers the import of existing contracts (#4723),
// with patterns relative to /traeger/contract-imports. The preview and the
// import take the same upload: the file plus the form fields.
func ImportRouteContracts() []common.RouteContract {
	upload := func(pattern string) common.RouteContract {
		return common.RouteContract{Method: "POST", Pattern: pattern, Portals: traegerPortal, Multipart: true,
			MaxBodyBytes: carecontract.MaxContractImportFileBytes + importFormOverhead,
			TooLargeCode: common.CodeCareContractImportFileTooLarge, Response: carecontract.ContractImport{}}
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: []carecontract.ContractImportEntry{}},
		upload("/"),
		upload("/preview"),
	}
}

// The bodies the link reads: the drawn signature as base64 PNG, and a number.
const (
	signBodyBytes           = 400 << 10
	familyChildrenBodyBytes = 1 << 10
)

// SigningRouteContracts registers the one-time link of a contract mail,
// which the parents open without a session (#2352), with patterns relative
// to /public/care-contract-signing. The frozen PDF is a public file of the
// link; reading it leaves the link open.
func SigningRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalPublic}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{link}", Portals: portals, Response: carecontract.SigningView{}},
		{Method: "GET", Pattern: "/{link}/document", Portals: portals, File: true,
			PublicFile: "the one-time link of the contract mail is the parents' only credential for the contract it names"},
		{Method: "POST", Pattern: "/{link}/sign", Portals: portals, Request: SignRequest{}, Response: carecontract.SigningView{}, MaxBodyBytes: signBodyBytes},
		{Method: "GET", Pattern: "/{link}/family-children", Portals: portals, Response: SigningFamilyChildrenResponse{}},
		{Method: "PUT", Pattern: "/{link}/family-children", Portals: portals, Request: SigningFamilyChildrenRequest{}, Response: SigningFamilyChildrenResponse{}, MaxBodyBytes: familyChildrenBodyBytes},
	}
}
