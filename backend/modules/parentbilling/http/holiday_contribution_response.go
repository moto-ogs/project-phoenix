package parentbillinghttp

import (
	"time"

	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// HolidayContributionResponse is capability.HolidayContribution as the
// route answers it, with the same JSON. Amounts are whole cent as int: the
// contract refuses an int64 that is no identifier (ADR 0270).
type HolidayContributionResponse struct {
	Children            []HolidayChildContributionResponse `json:"children"`
	TotalCents          int                                `json:"total_cents"`
	ExemptionAvailable  bool                               `json:"exemption_available"`
	BenefitsExemption   bool                               `json:"benefits_exemption"`
	CostBearerID        *ident.ID                          `json:"cost_bearer_id"`
	CostBearerName      string                             `json:"cost_bearer_name"`
	Frozen              bool                               `json:"frozen"`
	ConfirmedAt         *time.Time                         `json:"confirmed_at"`
	Invoiced            bool                               `json:"invoiced"`
	Siblings            []capability.HolidaySibling        `json:"siblings,omitempty"`
	SiblingDebtorNumber string                             `json:"sibling_debtor_number,omitempty"`
	SiblingsInvoiced    bool                               `json:"siblings_invoiced,omitempty"`
	CorrectionNeeded    bool                               `json:"correction_needed,omitempty"`
	// Fingerprint is the token of a preview the confirmation sends back
	// (ADR 0311); empty on a frozen contribution and on a quote.
	Fingerprint string `json:"fingerprint,omitempty"`
}

// HolidayChildContributionResponse is one child of the contribution.
type HolidayChildContributionResponse struct {
	ChildID    ident.ID                          `json:"child_id"`
	Position   int                               `json:"position"`
	Lines      []HolidayContributionLineResponse `json:"lines"`
	TotalCents int                               `json:"total_cents"`
}

// HolidayContributionLineResponse is one line of a child's contribution.
type HolidayContributionLineResponse struct {
	Kind                string         `json:"kind"`
	AmountCents         int            `json:"amount_cents"`
	WeekStartsOn        *calendar.Date `json:"week_starts_on"`
	WeekEndsOn          *calendar.Date `json:"week_ends_on"`
	TimeModelName       string         `json:"time_model_name"`
	ChildRank           *int           `json:"child_rank"`
	DiscountBasisPoints *int           `json:"discount_basis_points"`
	DiscountCents       *int           `json:"discount_cents"`
	Note                string         `json:"note"`
	CostBearerID        *ident.ID      `json:"cost_bearer_id"`
	CostBearerName      string         `json:"cost_bearer_name"`
	BookedDays          *int           `json:"booked_days"`
}

// HolidayConfirmationResponse is capability.HolidayConfirmation as the
// route answers it.
type HolidayConfirmationResponse struct {
	RegistrationID ident.ID                    `json:"id"`
	Status         string                      `json:"status"`
	Contribution   HolidayContributionResponse `json:"contribution"`
}

func holidayContributionResponse(c capability.HolidayContribution) HolidayContributionResponse {
	var children []HolidayChildContributionResponse
	if c.Children != nil {
		children = make([]HolidayChildContributionResponse, len(c.Children))
	}
	for i, child := range c.Children {
		var lines []HolidayContributionLineResponse
		if child.Lines != nil {
			lines = make([]HolidayContributionLineResponse, len(child.Lines))
		}
		for j, line := range child.Lines {
			lines[j] = HolidayContributionLineResponse{
				Kind: line.Kind, AmountCents: int(line.AmountCents), WeekStartsOn: line.WeekStartsOn, WeekEndsOn: line.WeekEndsOn,
				TimeModelName: line.TimeModelName, ChildRank: line.ChildRank, DiscountBasisPoints: line.DiscountBasisPoints,
				DiscountCents: centsOf(line.DiscountCents), Note: line.Note, CostBearerID: line.CostBearerID,
				CostBearerName: line.CostBearerName, BookedDays: line.BookedDays,
			}
		}
		children[i] = HolidayChildContributionResponse{ChildID: child.ChildID, Position: child.Position, Lines: lines, TotalCents: int(child.TotalCents)}
	}
	return HolidayContributionResponse{
		Children: children, TotalCents: int(c.TotalCents), ExemptionAvailable: c.ExemptionAvailable,
		BenefitsExemption: c.BenefitsExemption, CostBearerID: c.CostBearerID, CostBearerName: c.CostBearerName,
		Frozen: c.Frozen, ConfirmedAt: c.ConfirmedAt, Invoiced: c.Invoiced, Siblings: c.Siblings,
		SiblingDebtorNumber: c.SiblingDebtorNumber, SiblingsInvoiced: c.SiblingsInvoiced, CorrectionNeeded: c.CorrectionNeeded,
		Fingerprint: c.Fingerprint,
	}
}

func centsOf(cents *int64) *int {
	if cents == nil {
		return nil
	}
	value := int(*cents)
	return &value
}
