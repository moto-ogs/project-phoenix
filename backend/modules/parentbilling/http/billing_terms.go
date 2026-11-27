package parentbillinghttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// BillingTermsResource serves who gets an invoice, how it is paid and by
// when (#4689, ADR 0167): the terms and bundling of the services at
// /traeger/billing-terms, the deviations of the families at
// /traeger/family-billing and the due dates of a calculated run at
// /traeger/billing-run-due-dates. Every route sits behind the Träger
// session, needs the Träger right "Abrechnung" and runs in the Träger
// transaction of the session's Träger, which comes from the session, never
// from the request.
type BillingTermsResource struct {
	terms          capability.BillingTerms
	requireBilling common.Middleware
}

// NewBillingTermsResource builds the resource. requireBilling admits only a
// session with the Träger right "Abrechnung".
func NewBillingTermsResource(terms capability.BillingTerms, requireBilling common.Middleware) *BillingTermsResource {
	if terms == nil || requireBilling == nil {
		panic("parent billing http: the billing terms and the right check are required")
	}
	return &BillingTermsResource{terms: terms, requireBilling: requireBilling}
}

// TermsRouter returns the routes mounted at /traeger/billing-terms.
func (rs *BillingTermsResource) TermsRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		billing := r.With(rs.requireBilling, withTx)
		billing.Get("/", rs.serviceTerms)
		billing.Put("/{service}", rs.saveServiceTerms)
	})
	return r
}

// FamilyRouter returns the routes mounted at /traeger/family-billing.
func (rs *BillingTermsResource) FamilyRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		billing := r.With(rs.requireBilling, withTx)
		billing.Get("/contracts/{id}", rs.familyOfContract)
		billing.Put("/", rs.saveFamily)
	})
	return r
}

// DueDateRouter returns the routes mounted at /traeger/billing-run-due-dates.
func (rs *BillingTermsResource) DueDateRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		billing := r.With(rs.requireBilling, withTx)
		billing.Put("/care/{id}", rs.setCareDueDates)
		billing.Put("/holiday/{id}", rs.setHolidayDueDates)
	})
	return r
}

// BillingTermsResponse is the body of GET /traeger/billing-terms: the
// services with what each may travel with, and their terms.
type BillingTermsResponse struct {
	Services []capability.BillingService `json:"services"`
	Terms    []capability.ServiceTerms   `json:"terms"`
}

// ServiceTermsRequest is the body of PUT /traeger/billing-terms/{service}.
type ServiceTermsRequest struct {
	PaymentMethod string `json:"payment_method"`
	DueDays       int    `json:"due_days"`
	BundleWith    string `json:"bundle_with"`
	// ExpectedVersion is the version of the terms as they were read (ADR
	// 0311).
	ExpectedVersion string `json:"expected_version"`
}

// Bind accepts the body; the Owner validates the terms.
func (req *ServiceTermsRequest) Bind(*http.Request) error { return nil }

// FamilyBillingRequest is the body of PUT /traeger/family-billing: the
// deviation of the family of a contract of the Träger.
type FamilyBillingRequest struct {
	ContractID      ident.ID              `json:"contract_id"`
	RecipientKind   string                `json:"recipient_kind"`
	SecondFirstName string                `json:"second_first_name"`
	SecondLastName  string                `json:"second_last_name"`
	PayerFirstName  string                `json:"payer_first_name"`
	PayerLastName   string                `json:"payer_last_name"`
	PayerEmail      string                `json:"payer_email"`
	PayerAddress    *PostalAddressRequest `json:"payer_address"`
	PaymentMethod   string                `json:"payment_method"`
	DueDay          *int                  `json:"due_day"`
	DebtorNumber    string                `json:"debtor_number"`
	// ExpectedVersion is the version of GET /contracts/{id} the form read.
	ExpectedVersion string `json:"expected_version"`
}

// Bind accepts the body; the Owner validates the deviation.
func (req *FamilyBillingRequest) Bind(*http.Request) error { return nil }

func (req *FamilyBillingRequest) input() capability.FamilyBillingInput {
	return capability.FamilyBillingInput{
		ContractID: req.ContractID.Int64(), RecipientKind: req.RecipientKind, SecondFirstName: req.SecondFirstName, SecondLastName: req.SecondLastName,
		PayerFirstName: req.PayerFirstName, PayerLastName: req.PayerLastName, PayerEmail: req.PayerEmail,
		PayerAddress: (*capability.PostalAddress)(req.PayerAddress), PaymentMethod: req.PaymentMethod, DueDay: req.DueDay, DebtorNumber: req.DebtorNumber,
		ExpectedVersion: req.ExpectedVersion,
	}
}

// FamilyBillingResponse is the answer of PUT /traeger/family-billing: the
// stored deviation, or null when the family no longer deviates.
type FamilyBillingResponse struct {
	Family *capability.FamilyBilling `json:"family"`
}

// RunDueDatesRequest is the body of PUT
// /traeger/billing-run-due-dates/{care|holiday}/{id}: the due date per
// payment method; a method without a date falls back to the payment term.
type RunDueDatesRequest struct {
	DueDates []RunDueDateRequest `json:"due_dates"`
	// ExpectedVersion is the due_dates_version of the run as it was read
	// (ADR 0311).
	ExpectedVersion string `json:"expected_version"`
}

// RunDueDateRequest is the due date of one payment method.
type RunDueDateRequest struct {
	PaymentMethod string        `json:"payment_method"`
	DueOn         calendar.Date `json:"due_on"`
}

// Bind accepts the body; the Owner validates the dates.
func (req *RunDueDatesRequest) Bind(*http.Request) error { return nil }

func (req *RunDueDatesRequest) dates() capability.RunDueDates {
	dates := capability.RunDueDates{}
	for _, due := range req.DueDates {
		dates[due.PaymentMethod] = due.DueOn
	}
	return dates
}

// RunDueDatesResponse is the answer of the due dates of a run.
type RunDueDatesResponse struct {
	DueDates []capability.RunDueDate `json:"due_dates"`
}

func (rs *BillingTermsResource) serviceTerms(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	terms, err := rs.terms.ServiceTerms(r.Context(), organizationID)
	if err != nil {
		renderTermsError(w, r, err, common.CodeParentBillingBillingTermsInvalid)
		return
	}
	common.Respond(w, r, http.StatusOK, BillingTermsResponse{Services: capability.BillingServices, Terms: terms},
		"Billing terms retrieved successfully")
}

func (rs *BillingTermsResource) saveServiceTerms(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	req := &ServiceTermsRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingBillingTermsInvalid))
		return
	}
	terms, err := rs.terms.SaveServiceTerms(r.Context(), reviewer, capability.ServiceTerms{
		Service: chi.URLParam(r, "service"), PaymentMethod: req.PaymentMethod, DueDays: req.DueDays, BundleWith: req.BundleWith,
	}, req.ExpectedVersion)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderTermsError(w, r, err, common.CodeParentBillingBillingTermsInvalid)
		return
	}
	common.Respond(w, r, http.StatusOK, BillingTermsResponse{Services: capability.BillingServices, Terms: terms},
		"Billing terms saved successfully")
}

// familyOfContract answers the family of a contract with its deviation, so
// its payment method is set without an invoice (#7770). A contract of
// another Träger names no family: 404.
func (rs *BillingTermsResource) familyOfContract(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	contractID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyBillingInvalid))
		return
	}
	family, err := rs.terms.FamilyBillingOfContract(r.Context(), reviewer, contractID)
	if errors.Is(err, capability.ErrFamilyUnknown) {
		tenant.MarkRollback(r.Context())
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeParentBillingFamilyBillingNotFound))
		return
	}
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderTermsError(w, r, err, common.CodeParentBillingFamilyBillingInvalid)
		return
	}
	common.Respond(w, r, http.StatusOK, family, "Family billing of the contract retrieved successfully")
}

func (rs *BillingTermsResource) saveFamily(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	req := &FamilyBillingRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyBillingInvalid))
		return
	}
	family, err := rs.terms.SaveFamilyBilling(r.Context(), reviewer, req.input())
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderTermsError(w, r, err, common.CodeParentBillingFamilyBillingInvalid)
		return
	}
	common.Respond(w, r, http.StatusOK, FamilyBillingResponse{Family: family}, "Family billing saved successfully")
}

func (rs *BillingTermsResource) setCareDueDates(w http.ResponseWriter, r *http.Request) {
	rs.setDueDates(w, r, rs.terms.SetCareRunDueDates)
}

func (rs *BillingTermsResource) setHolidayDueDates(w http.ResponseWriter, r *http.Request) {
	rs.setDueDates(w, r, rs.terms.SetHolidayRunDueDates)
}

type dueDateSetter func(ctx context.Context, reviewer capability.HolidayReviewer, runID int64, dates capability.RunDueDates,
	expectedVersion string) (capability.RunDueDates, error)

func (rs *BillingTermsResource) setDueDates(w http.ResponseWriter, r *http.Request, set dueDateSetter) {
	reviewer, runID, ok := runKey(w, r)
	if !ok {
		return
	}
	req := &RunDueDatesRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingDueDatesInvalid))
		return
	}
	dates, err := set(r.Context(), reviewer, runID, req.dates(), req.ExpectedVersion)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderTermsError(w, r, err, common.CodeParentBillingDueDatesInvalid)
		return
	}
	common.Respond(w, r, http.StatusOK, RunDueDatesResponse{DueDates: dates.InPaymentOrder()}, "Run due dates saved successfully")
}

// renderTermsError answers a refused term, deviation or due date with the
// input code of its route; the refusals of a run keep the codes of the run.
func renderTermsError(w http.ResponseWriter, r *http.Request, err error, invalidCode string) {
	var fields validation.Errors
	if renderDebtorNumberFormat(w, r, err) {
		return
	}
	switch {
	case errors.As(err, &fields), errors.Is(err, capability.ErrServiceUnknown):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, invalidCode))
	case errors.Is(err, capability.ErrFamilyBillingNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeParentBillingFamilyBillingNotFound))
	case errors.Is(err, capability.ErrFamilyUnknown):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeParentBillingFamilyUnknown))
	case errors.Is(err, capability.ErrCareRunNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeParentBillingCareRunNotFound))
	default:
		renderBillingConflict(w, r, err)
	}
}
