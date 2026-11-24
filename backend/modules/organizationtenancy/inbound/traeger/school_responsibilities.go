package traeger

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// Responsibilities at the schools of the session's Träger (#4811), below
// the master data at /traeger/master-data/responsibilities: who concludes
// contracts, bills and employs at each school, and the master data of its
// Schulträger and Gemeinde. The choices themselves are settings
// (/traeger/settings and the school's settings). Reading needs "Übersicht
// lesen", writing "Einstellungen", like the Träger's own master data.

// SchoolPartyRequest is the body of PUT
// /traeger/master-data/responsibilities/schools/{schoolId}/parties/{kind}:
// the master data of the body with the version they were read with (ADR
// 0311); a body the school has none of yet sends an empty version.
type SchoolPartyRequest struct {
	Name          string `json:"name"`
	Street        string `json:"street"`
	PostalCode    string `json:"postal_code"`
	City          string `json:"city"`
	ContactName   string `json:"contact_name"`
	ContactPhone  string `json:"contact_phone"`
	ContactEmail  string `json:"contact_email"`
	CreditorID    string `json:"creditor_id" contract_text:"SEPA creditor identifier of the body, a text the bank assigns"`
	AccountHolder string `json:"account_holder"`
	IBAN          string `json:"iban"`
	BIC           string `json:"bic"`
	BankName      string `json:"bank_name"`
	// ExpectedVersion is the version of the stored body, empty for a new
	// one.
	ExpectedVersion string `json:"expected_version"`
}

// Bind accepts the body; the Owner validates it.
func (req *SchoolPartyRequest) Bind(*http.Request) error { return nil }

func (req *SchoolPartyRequest) input() organizationtenancy.SchoolPartyInput {
	return organizationtenancy.SchoolPartyInput{
		Name: req.Name, Street: req.Street, PostalCode: req.PostalCode, City: req.City,
		ContactName: req.ContactName, ContactPhone: req.ContactPhone, ContactEmail: req.ContactEmail,
		CreditorID: req.CreditorID, AccountHolder: req.AccountHolder, IBAN: req.IBAN, BIC: req.BIC, BankName: req.BankName,
	}
}

// responsibilityRoutes mounts the responsibilities into the master data
// router.
func (rs *MasterDataResource) responsibilityRoutes(read, manage chi.Router) {
	read.Get("/responsibilities", rs.responsibilities)
	manage.Put("/responsibilities/schools/{schoolId}/parties/{kind}", rs.saveSchoolParty)
	manage.Delete("/responsibilities/schools/{schoolId}/parties/{kind}", rs.removeSchoolParty)
}

func (rs *MasterDataResource) responsibilities(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := session(w, r)
	if !ok {
		return
	}
	overview, err := rs.responsible.Overview(r.Context(), organizationID, accountID)
	if err != nil {
		renderSchoolPartyError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, overview, "Responsibilities retrieved successfully")
}

func (rs *MasterDataResource) saveSchoolParty(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := session(w, r)
	if !ok {
		return
	}
	schoolID, err := common.ParseIDParam(r, "schoolId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	req := &SchoolPartyRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	party, err := rs.responsible.SaveParty(r.Context(), organizationID, accountID, schoolID,
		organizationtenancy.ResponsibleBody(chi.URLParam(r, "kind")), req.input(), req.ExpectedVersion)
	if err != nil {
		renderSchoolPartyError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, party, "School party saved successfully")
}

func (rs *MasterDataResource) removeSchoolParty(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := session(w, r)
	if !ok {
		return
	}
	schoolID, err := common.ParseIDParam(r, "schoolId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err := rs.responsible.RemoveParty(r.Context(), organizationID, accountID, schoolID,
		organizationtenancy.ResponsibleBody(chi.URLParam(r, "kind"))); err != nil {
		renderSchoolPartyError(w, r, err)
		return
	}
	common.RespondNoContent(w, r)
}

// renderSchoolPartyError answers a refused operation on a body. Every
// refusal is decided before the first write.
func renderSchoolPartyError(w http.ResponseWriter, r *http.Request, err error) {
	var fields validation.Errors
	var creditor *organizationtenancy.SchoolPartyCreditorConflictError
	switch {
	case errors.As(err, &fields):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerMasterDataInvalid))
	case errors.As(err, &creditor):
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeTraegerSchoolPartyCreditorAccountConflict,
			map[string]any{"school_name": creditor.SchoolName}))
	case errors.Is(err, organizationtenancy.ErrSchoolPartySchoolNotFound),
		errors.Is(err, organizationtenancy.ErrSchoolPartyNotFound),
		errors.Is(err, organizationtenancy.ErrSchoolPartyKindUnknown):
		common.RenderError(w, r, common.ErrorNotFound(err))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}
