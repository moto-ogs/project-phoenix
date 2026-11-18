package traegercataloghttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/workflows/traegercatalog"
)

// RouteContracts registers the Träger's catalog of phases and care
// offerings (ADR 0270), with patterns relative to /traeger/catalog. The
// export answers a file and keeps its route file.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/phases", Portals: portals, Response: []enrollment.TraegerPhase{}},
		{Method: "POST", Pattern: "/phases", Portals: portals, Request: PhaseRequest{}, Response: PhaseDetail{}},
		{Method: "GET", Pattern: "/phases/{id}", Portals: portals, Response: PhaseDetail{}},
		{Method: "PUT", Pattern: "/phases/{id}", Portals: portals, Request: PhaseRequest{}, Response: PhaseDetail{}},
		{Method: "POST", Pattern: "/phases/{id}/withdraw", Portals: portals, Response: PhaseDetail{}},
		{Method: "POST", Pattern: "/phases/{id}/offerings", Portals: portals, Request: OfferingRequest{}, Response: careplan.TraegerOffering{}},
		{Method: "PUT", Pattern: "/offerings/{id}", Portals: portals, Request: OfferingRequest{}, Response: careplan.TraegerOffering{}},
		{Method: "POST", Pattern: "/offerings/{id}/withdraw", Portals: portals, Response: careplan.TraegerOffering{}},
		{Method: "POST", Pattern: "/phases/{id}/preview", Portals: portals, Response: traegercatalog.Preview{}},
		{Method: "POST", Pattern: "/phases/{id}/rollout", Portals: portals, Request: RolloutRequest{}, Response: traegercatalog.Rollout{}},
	}
}

// OfferingFieldsRequest is careplan.TraegerOfferingFields as the body sends
// it; the answer carries the careplan type itself.
type OfferingFieldsRequest struct {
	IsActive            *bool             `json:"is_active,omitempty"`
	Name                string            `json:"name"`
	Description         *string           `json:"description"`
	DaysOfWeekMode      string            `json:"days_of_week_mode"`
	AvailableDays       []string          `json:"available_days"`
	IncludesHolidayCare bool              `json:"includes_holiday_care"`
	IncludesLunch       bool              `json:"includes_lunch"`
	Capacity            *int              `json:"capacity"`
	PriceCents          *int              `json:"price_cents"`
	IsRequired          bool              `json:"is_required"`
	CountsAsCare        bool              `json:"counts_as_care"`
	SelectionGroup      string            `json:"selection_group"`
	SelectionRule       string            `json:"selection_rule"`
	SortOrder           int               `json:"sort_order"`
	PickupTimes         map[string]string `json:"pickup_times"`
}

// CarePriceRequest is one price of the body.
type CarePriceRequest struct {
	Weekday      string `json:"weekday,omitempty"`
	DaysPerWeek  *int   `json:"days_per_week,omitempty"`
	MonthlyCents int    `json:"monthly_cents"`
	SiblingCents *int   `json:"sibling_cents,omitempty"`
	MealExtra    bool   `json:"meal_extra"`
}

// ContractTemplateRequest is the contract template of the body.
type ContractTemplateRequest struct {
	TermKind               string `json:"term_kind"`
	TermMonths             *int   `json:"term_months,omitempty"`
	NoticeMonths           int    `json:"notice_months"`
	NoticeTo               string `json:"notice_to"`
	SpecialTermination     bool   `json:"special_termination"`
	SpecialTerminationNote string `json:"special_termination_note"`
	StatuteRequired        bool   `json:"statute_required"`
	StatuteTitle           string `json:"statute_title"`
	StatuteURL             string `json:"statute_url"`
	ContractPartner        string `json:"contract_partner"`
}

func (req *OfferingRequest) draft() careplan.TraegerOfferingDraft {
	f := req.Fields
	draft := careplan.TraegerOfferingDraft{Fields: careplan.TraegerOfferingFields{
		IsActive: f.IsActive, Name: f.Name, Description: f.Description, DaysOfWeekMode: f.DaysOfWeekMode,
		AvailableDays: f.AvailableDays, IncludesHolidayCare: f.IncludesHolidayCare, IncludesLunch: f.IncludesLunch,
		Capacity: f.Capacity, PriceCents: f.PriceCents, IsRequired: f.IsRequired, CountsAsCare: f.CountsAsCare,
		SelectionGroup: f.SelectionGroup, SelectionRule: f.SelectionRule, SortOrder: f.SortOrder, PickupTimes: f.PickupTimes,
	}}
	if req.Prices != nil {
		draft.Prices = make([]careplan.TraegerCarePrice, len(req.Prices))
	}
	for i, price := range req.Prices {
		draft.Prices[i] = careplan.TraegerCarePrice(price)
	}
	if req.ContractTemplate != nil {
		template := careplan.TraegerContractTemplate(*req.ContractTemplate)
		draft.ContractTemplate = &template
	}
	return draft
}
