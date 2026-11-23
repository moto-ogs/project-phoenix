package parentbillinghttp

import (
	"errors"
	"net/http"

	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// CareAmendmentRequest is the body of POST …/{id}/amendments (#6197): one
// change of one invoice of a calculated run, or the revocation of one.
// ContractID and Service name the invoice, Fingerprint the review the
// change was made on; Kind decides which of the other fields count.
type CareAmendmentRequest struct {
	ContractID     ident.ID              `json:"contract_id"`
	Service        string                `json:"service"`
	Kind           string                `json:"kind"`
	Fingerprint    string                `json:"fingerprint"`
	Reason         string                `json:"reason"`
	TotalCents     *int64                `json:"total_cents" contract:"number"`
	Label          string                `json:"label"`
	AmountCents    *int64                `json:"amount_cents" contract:"number"`
	PositionKey    string                `json:"position_key"`
	Recipient      *RecipientNameRequest `json:"recipient"`
	Address        *PostalAddressRequest `json:"address"`
	RevokesID      ident.ID              `json:"revokes_id"`
	RevokesCarried bool                  `json:"revokes_carried"`
}

// RecipientNameRequest is the new recipient of an invoice in the body of a
// change.
type RecipientNameRequest struct {
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
	SecondName string `json:"second_name"`
	Email      string `json:"email"`
}

// PostalAddressRequest is the new postal address of an invoice in the body
// of a change.
type PostalAddressRequest struct {
	Street     string `json:"street"`
	PostalCode string `json:"postal_code"`
	City       string `json:"city"`
}

// Bind accepts the body; the Owner checks the change against the invoice.
func (req *CareAmendmentRequest) Bind(*http.Request) error { return nil }

// amend answers POST …/{id}/amendments with the run after the change.
func (rs *CareBillingResource) amend(w http.ResponseWriter, r *http.Request) {
	reviewer, runID, ok := runKey(w, r)
	if !ok {
		return
	}
	req := &CareAmendmentRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingCareAmendmentInvalid))
		return
	}
	detail, err := rs.billing.AmendCareInvoice(r.Context(), reviewer, runID, capability.CareAmendmentInput{
		ContractID: req.ContractID.Int64(), Service: req.Service, Kind: req.Kind, Fingerprint: req.Fingerprint, Reason: req.Reason,
		TotalCents: req.TotalCents, Label: req.Label, AmountCents: req.AmountCents, PositionKey: req.PositionKey,
		Recipient: (*capability.CareRecipientName)(req.Recipient), Address: (*capability.PostalAddress)(req.Address), RevokesID: req.RevokesID.Int64(), RevokesCarried: req.RevokesCarried,
	})
	var fields validation.Errors
	if errors.As(err, &fields) {
		err = amendmentInvalid{err}
	}
	rs.respondReview(w, r, detail, err, "Invoice changed successfully")
}

// amendmentInvalid marks a refused change of an invoice whose fields are
// wrong, so it answers with the code of the change rather than of the run.
type amendmentInvalid struct{ error }

func (e amendmentInvalid) Unwrap() error { return e.error }
