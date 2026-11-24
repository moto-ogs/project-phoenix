package carecontracthttp

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ApplicationContractResource serves /care-contracts in the staff portal
// (#4788, ADR 0088 section 7): the school reads, in its own tenant
// transaction, the contracts the Träger made from the children of an
// application, behind the right of the enrollment detail.
type ApplicationContractResource struct {
	contracts carecontract.ApplicationContracts
	audit     ApplicationContractAccessLog
	require   common.Middleware
}

// ApplicationContractAccessLog records a successful school-side contract
// read in the audit tenant transaction.
type ApplicationContractAccessLog interface {
	RecordApplicationContractAccess(context.Context, []carecontract.ApplicationContract) error
}

// NewApplicationContractResource builds the resource; require is the right
// check of the enrollment detail.
func NewApplicationContractResource(contracts carecontract.ApplicationContracts, audit ApplicationContractAccessLog, require common.Middleware) *ApplicationContractResource {
	if contracts == nil || audit == nil || require == nil {
		panic("care contract http: the application contracts, access log and right check are required")
	}
	return &ApplicationContractResource{contracts: contracts, audit: audit, require: require}
}

// Router returns the routes mounted at /care-contracts.
func (rs *ApplicationContractResource) Router(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTenantRoutes(r, func(r chi.Router, withTx common.Middleware) {
		r.With(rs.require, withTx).Get("/", rs.list)
	})
	return r
}

// ApplicationContractService is one module on one weekday of the newest
// version: „Montag, Ganztag bis 16:00“.
type ApplicationContractService struct {
	Weekday    string         `json:"weekday"`
	ModuleName string         `json:"module_name"`
	EndsAt     string         `json:"ends_at"`
	LastDay    *calendar.Date `json:"last_day"`
}

// ApplicationContractConclusion is how and when the contract was concluded.
// A contract taken over from an import (TakenOver) knows at most its day,
// and DateUnknown tells that the office does not know it: At is then only a
// stand-in the school must not show as the day of the conclusion (#7767).
type ApplicationContractConclusion struct {
	Method      string    `json:"method"`
	At          time.Time `json:"at"`
	DateUnknown bool      `json:"date_unknown"`
	TakenOver   bool      `json:"taken_over"`
}

// ApplicationContractResponse is the contract of one child of the
// application.
type ApplicationContractResponse struct {
	RequestChildID ident.ID                       `json:"request_child_id"`
	ContractID     ident.ID                       `json:"contract_id"`
	Status         string                         `json:"status"`
	SentAt         *time.Time                     `json:"sent_at"`
	Concluded      *ApplicationContractConclusion `json:"concluded"`
	EndsOn         *calendar.Date                 `json:"ends_on"`
	EffectiveFrom  *calendar.Date                 `json:"effective_from"`
	Services       []ApplicationContractService   `json:"services"`
}

var errRequestChildIDs = errors.New("request_child_ids must list between 1 and 50 numeric IDs")

// list answers GET /care-contracts?request_child_ids=1,2: the contracts of
// these application children at the school, a child without one left out.
func (rs *ApplicationContractResource) list(w http.ResponseWriter, r *http.Request) {
	ids, err := requestChildIDs(strings.Join(r.URL.Query()["request_child_ids"], ","))
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	contracts, err := rs.contracts.ApplicationContracts(r.Context(), ids)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	if err := rs.audit.RecordApplicationContractAccess(r.Context(), contracts); err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	result := make([]ApplicationContractResponse, len(contracts))
	for i, contract := range contracts {
		result[i] = applicationContractResponse(contract)
	}
	common.Respond(w, r, http.StatusOK, result, "Application contracts retrieved successfully")
}

func requestChildIDs(raw string) ([]int64, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errRequestChildIDs
	}
	parts := strings.Split(raw, ",")
	if len(parts) > carecontract.MaxApplicationChildren {
		return nil, errRequestChildIDs
	}
	ids := make([]int64, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || id <= 0 {
			return nil, errRequestChildIDs
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func applicationContractResponse(contract carecontract.ApplicationContract) ApplicationContractResponse {
	services := make([]ApplicationContractService, len(contract.Services))
	for i, service := range contract.Services {
		services[i] = ApplicationContractService{Weekday: service.Weekday, ModuleName: service.ModuleName,
			EndsAt: service.EndsAt, LastDay: service.LastDay}
	}
	response := ApplicationContractResponse{
		RequestChildID: ident.ID(contract.RequestChildID), ContractID: ident.ID(contract.ContractID),
		Status: contract.Status, SentAt: contract.SentAt, EndsOn: contract.EndsOn,
		EffectiveFrom: contract.EffectiveFrom, Services: services,
	}
	if contract.Concluded != nil {
		response.Concluded = &ApplicationContractConclusion{Method: contract.Concluded.Method, At: contract.Concluded.At,
			DateUnknown: contract.Concluded.DateUnknown, TakenOver: contract.Concluded.TakenOver}
	}
	return response
}
