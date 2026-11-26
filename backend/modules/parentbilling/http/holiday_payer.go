package parentbillinghttp

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The payer of a confirmed holiday registration (#8158, ADR 0325): GET
// previews what a change to the payer of the query would freeze, PUT saves
// it. Both need the Träger right "Anmeldung verwalten", like the
// confirmation.

// HolidayPayerRequest is the body of PUT
// /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/payer:
// benefits_exemption applies the exemption, cost_bearer_id lets that cost
// bearer pay, neither lets the family pay. reason says why, for the history
// of the registration. expected_fingerprint is the fingerprint of the
// preview the Büro read (ADR 0311); a changed or missing one is refused.
type HolidayPayerRequest struct {
	BenefitsExemption   bool     `json:"benefits_exemption"`
	CostBearerID        ident.ID `json:"cost_bearer_id"`
	Reason              string   `json:"reason"`
	ExpectedFingerprint string   `json:"expected_fingerprint"`
}

// Bind needs a reason of at most HolidayPayerReasonMaxLength characters;
// the owner checks the payer.
func (req *HolidayPayerRequest) Bind(*http.Request) error {
	req.Reason = strings.TrimSpace(req.Reason)
	switch {
	case req.Reason == "":
		return validation.Errors{"reason": errors.New("is required")}
	case utf8.RuneCountInString(req.Reason) > capability.HolidayPayerReasonMaxLength:
		return validation.Errors{"reason": fmt.Errorf("must be at most %d characters", capability.HolidayPayerReasonMaxLength)}
	}
	return nil
}

// HolidayPayerPreviewResponse is capability.HolidayPayerPreview as the
// route answers it, with the amounts as int (ADR 0270).
type HolidayPayerPreviewResponse struct {
	Current            capability.HolidayPayer           `json:"current"`
	Chosen             capability.HolidayPayer           `json:"chosen"`
	Changed            bool                              `json:"changed"`
	Children           []HolidayPayerChildEffectResponse `json:"children"`
	ExemptionAvailable bool                              `json:"exemption_available"`
	Invoiced           bool                              `json:"invoiced"`
	Fingerprint        string                            `json:"fingerprint"`
}

// HolidayPayerChildEffectResponse is the effect of a payer change on one
// child, in whole cent.
type HolidayPayerChildEffectResponse struct {
	ChildID               ident.ID `json:"child_id"`
	Position              int      `json:"position"`
	FamilyBeforeCents     int      `json:"family_before_cents"`
	FamilyAfterCents      int      `json:"family_after_cents"`
	CostBearerBeforeCents int      `json:"cost_bearer_before_cents"`
	CostBearerAfterCents  int      `json:"cost_bearer_after_cents"`
}

func holidayPayerPreviewResponse(preview capability.HolidayPayerPreview) HolidayPayerPreviewResponse {
	children := make([]HolidayPayerChildEffectResponse, len(preview.Children))
	for i, child := range preview.Children {
		children[i] = HolidayPayerChildEffectResponse{
			ChildID: child.ChildID, Position: child.Position,
			FamilyBeforeCents: int(child.FamilyBeforeCents), FamilyAfterCents: int(child.FamilyAfterCents),
			CostBearerBeforeCents: int(child.CostBearerBeforeCents), CostBearerAfterCents: int(child.CostBearerAfterCents),
		}
	}
	return HolidayPayerPreviewResponse{
		Current: preview.Current, Chosen: preview.Chosen, Changed: preview.Changed, Children: children,
		ExemptionAvailable: preview.ExemptionAvailable, Invoiced: preview.Invoiced, Fingerprint: preview.Fingerprint,
	}
}

// payerPreview answers what a change to the payer of the query would
// freeze: benefits_exemption=true, cost_bearer_id=<id>, or neither for the
// family.
func (rs *HolidayResource) payerPreview(w http.ResponseWriter, r *http.Request) {
	reviewer, periodID, registrationID, ok := registrationKey(w, r)
	if !ok {
		return
	}
	exemption, costBearerID, err := previewChoice(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	choice := capability.HolidayPayerChoice{BenefitsExemption: exemption != nil && *exemption, CostBearerID: costBearerID}
	preview, err := rs.payers.HolidayPayerChange(r.Context(), reviewer, periodID, registrationID, choice)
	if err != nil {
		renderHolidayError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, holidayPayerPreviewResponse(preview), "Holiday payer change previewed")
}

// changePayer saves the payer of a confirmed registration. Any refusal
// rolls the Träger transaction back, so no audit entry stays without its
// contribution.
func (rs *HolidayResource) changePayer(w http.ResponseWriter, r *http.Request) {
	reviewer, periodID, registrationID, ok := registrationKey(w, r)
	if !ok {
		return
	}
	req := &HolidayPayerRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	choice := capability.HolidayPayerChoice{BenefitsExemption: req.BenefitsExemption, CostBearerID: req.CostBearerID.Int64()}
	contribution, err := rs.payers.ChangeHolidayPayer(r.Context(), reviewer, periodID, registrationID, choice, req.Reason, req.ExpectedFingerprint)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderHolidayError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, holidayContributionResponse(contribution), "Holiday payer changed successfully")
}
