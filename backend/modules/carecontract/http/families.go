package carecontracthttp

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The families of the contracts without a mail address (#7161, ADR 0319)
// at /traeger/contract-families. Every route runs in the Träger transaction
// of the session's Träger; a failure rolls it back with the trail entry of
// the read. A refused change answers 409 with
// care_contract.family_refused, a change on another version than the
// stored one with general.changed_since_read.

// FamilyRouter returns the routes mounted at /traeger/contract-families.
// requireFamilies is the right check of the families: the office that
// imports the contracts and the Abrechnung that bills the siblings both
// join them (ADR 0319 point 8).
func (rs *Resource) FamilyRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware)), requireFamilies common.Middleware) chi.Router {
	if requireFamilies == nil {
		panic("care contract http: the right check of the families is required")
	}
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		open := r.With(requireFamilies, withTx)
		open.Get("/", rs.families)
		open.Get("/export", rs.exportFamilies)
		open.Post("/", rs.joinFamily)
		open.Post("/{contractId}/leave", rs.leaveFamily)
	})
	return r
}

// FamilyJoinRequest joins contracts to one family.
type FamilyJoinRequest struct {
	carecontract.FamilyJoinInput
}

// Bind accepts the body; the owner checks the choice and the version.
func (req *FamilyJoinRequest) Bind(*http.Request) error { return nil }

// FamilyLeaveRequest names the version of the families the office read.
type FamilyLeaveRequest struct {
	ExpectedVersion string `json:"expected_version"`
}

// Bind accepts the body; the owner checks the version.
func (req *FamilyLeaveRequest) Bind(*http.Request) error { return nil }

func (rs *Resource) families(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	set, err := rs.contracts.ContractFamilies(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, set, "Contract families read")
}

func (rs *Resource) joinFamily(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	req := &FamilyJoinRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	set, err := rs.contracts.JoinContractFamily(r.Context(), reviewer, req.FamilyJoinInput)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, set, "Contracts joined to one family")
}

func (rs *Resource) leaveFamily(w http.ResponseWriter, r *http.Request) {
	reviewer, contractID, ok := childLinkContract(w, r)
	if !ok {
		return
	}
	req := &FamilyLeaveRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	set, err := rs.contracts.LeaveContractFamily(r.Context(), reviewer, contractID, req.ExpectedVersion)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, set, "Contract left its family")
}

// FamilyRouteContracts registers the families of the contracts without a
// mail address, with patterns relative to /traeger/contract-families.
func FamilyRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: carecontract.ContractFamilySet{}},
		// The families as a file (#4718): PDF, Excel or CSV.
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: []common.QueryParam{common.ListFormatQuery}, File: true},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: FamilyJoinRequest{}, Response: carecontract.ContractFamilySet{}},
		{Method: "POST", Pattern: "/{contractId}/leave", Portals: traegerPortal, Request: FamilyLeaveRequest{},
			Response: carecontract.ContractFamilySet{}},
	}
}

// exportFamilies answers the families as a file (#4718), one row per
// contract, in the order of the page. The read stands in the trail like the
// page's.
func (rs *Resource) exportFamilies(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, err := common.ParseListFormat(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	set, err := rs.contracts.ContractFamilies(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, familyTable(set.Contracts))
}

// familyTable is one row per contract without a mail address with the
// family it belongs to.
func familyTable(contracts []carecontract.FamilyMember) common.ListTable {
	led := map[ident.ID]bool{}
	for _, contract := range contracts {
		if contract.FamilyContractID != contract.ContractID {
			led[contract.FamilyContractID] = true
		}
	}
	rows := make([][]string, 0, len(contracts))
	for _, contract := range contracts {
		birth := ""
		if contract.ChildBirthDate != nil {
			birth = contract.ChildBirthDate.Format("02.01.2006")
		}
		family := "Einzeln"
		switch {
		case contract.FamilyContractID != contract.ContractID:
			family = "Geschwister von Vertrag Nr. " + contract.FamilyContractID.String()
		case led[contract.ContractID]:
			family = "Führt die Familie"
		}
		rows = append(rows, []string{contract.ContractID.String(), contract.ChildLastName, contract.ChildFirstName, birth,
			contract.PartyName, contract.SchoolName, family})
	}
	return common.ListTable{
		Title: "Geschwister ohne Mail-Adresse", Filters: []string{"Alle Schulen"},
		Columns: []common.ListColumn{
			{ID: "number", Label: "Vertrag Nr."}, {ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"},
			{ID: "birth_date", Label: "Geburtsdatum"}, {ID: "party", Label: "Eltern"}, {ID: "school", Label: "Betreuungsort"},
			{ID: "family", Label: "Familie"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter, Filename: "geschwister-ohne-mail-adresse",
	}
}
