// Package absencetypes exposes the school's own Abwesenheitsarten (#2403):
// wiederverwendbare Bezeichnungen a school adds next to the five standard types
// (Urlaub, Krank, Fortbildung, Sonstige, Freizeitausgleich), which stay code
// constants and are neither listed nor changeable here.
//
// Guarded by time_tracking:manage — the same permission that already governs
// entering and deleting staff absences.
//
// There is deliberately no DELETE: an art that was used has to stay readable on
// its historical absences, so retirement is `is_active: false`.
//
// Authentication, transaction scoping, permission names, rendering and the
// actor lookup are supplied by the composition root through Runtime.
package absencetypes

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// Middleware is the HTTP middleware shape the composition root supplies.
type Middleware = func(http.Handler) http.Handler

// FailureKind classifies a handler failure so the composition root can render
// it with the project's shared error envelope.
type FailureKind string

const (
	FailureInvalid   FailureKind = "invalid"
	FailureNotFound  FailureKind = "not_found"
	FailureConflict  FailureKind = "conflict"
	FailureForbidden FailureKind = "forbidden"
	FailureInternal  FailureKind = "internal"
)

// ErrNoStaffActor refuses an allowance change by a caller without a staff
// record of the school: every change is recorded against a staff member,
// also in a session opened through the Träger-Portal (#7818).
var ErrNoStaffActor = errors.New("current staff member not found")

// Runtime carries the HTTP-platform behavior this adapter must not own. Every
// field is required, so missing production wiring fails at startup.
type Runtime struct {
	Protected     func(chi.Router, func(chi.Router, Middleware))
	Permission    func(string) Middleware
	AnyPermission func(...string) Middleware
	ParseID       func(*http.Request) (int64, error)
	ParseIDParam  func(*http.Request, string) (int64, error)
	Success       func(http.ResponseWriter, *http.Request, int, any, string)
	Failure       func(http.ResponseWriter, *http.Request, FailureKind, error)
	// ResolveActor identifies the staff member behind the request; an
	// allowance change is recorded against that person. An error wrapping
	// ErrNoStaffActor is the caller's (403), any other the server's.
	ResolveActor func(context.Context) (int64, error)
	// Permission names. Reading is open to anyone who may decide absences
	// too, so the Leitung's approval views can render the school's wording.
	TimeTrackingOwn    string
	TimeTrackingManage string
	VacationApprove    string
}

// Resource bundles the dependencies for the absence-type HTTP handlers.
type Resource struct {
	types   workforce.AbsenceTypeAdministration
	runtime Runtime
}

// NewResource wires the dependencies.
func NewResource(types workforce.AbsenceTypeAdministration, runtime Runtime) *Resource {
	return &Resource{types: types, runtime: runtime}
}

// Router returns the chi sub-router for /api/absence-types.
func (rs *Resource) Router() chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))

	rs.runtime.Protected(r, func(r chi.Router, withTx Middleware) {
		read := rs.runtime.AnyPermission(rs.runtime.TimeTrackingOwn, rs.runtime.TimeTrackingManage, rs.runtime.VacationApprove)
		manage := rs.runtime.Permission(rs.runtime.TimeTrackingManage)
		allowanceRead := rs.runtime.AnyPermission(rs.runtime.TimeTrackingManage, rs.runtime.VacationApprove)
		r.With(read, withTx).Get("/", rs.list)
		r.With(manage, withTx).Post("/", rs.create)
		r.With(manage, withTx).Put("/{id}", rs.update)
		r.With(allowanceRead, withTx).Get("/{id}/allowances/{staffId}", rs.getAllowance)
		r.With(allowanceRead, withTx).Get("/{id}/allowances/{staffId}/preview", rs.previewAllowance)
		r.With(manage, withTx).Put("/{id}/allowances/{staffId}", rs.setAllowance)
	})

	return r
}

// CreateAbsenceTypeRequest is the create payload. Only the name is accepted:
// the base type is not client-controlled.
type CreateAbsenceTypeRequest struct {
	Name             string `json:"name"`
	AllowanceEnabled bool   `json:"allowance_enabled"`
	// CarryoverUntil is "MM-DD" in the following year until which a rest
	// stays usable; empty or omitted lets it expire on 31.12. (#3257).
	CarryoverUntil string `json:"carryover_until"`
	// Requestable lets staff request the type; the Leitung decides (#4710).
	Requestable bool `json:"requestable"`
}

// UpdateAbsenceTypeRequest renames and/or (de)activates. Omitted fields stay
// as they are, so a rename cannot accidentally reactivate a retired art.
type UpdateAbsenceTypeRequest struct {
	Name             *string `json:"name"`
	IsActive         *bool   `json:"is_active"`
	AllowanceEnabled *bool   `json:"allowance_enabled"`
	// CarryoverUntil: omitted keeps the rule, "" ends it at 31.12.
	CarryoverUntil *string `json:"carryover_until"`
	Requestable    *bool   `json:"requestable"`
	// Offered and SchoolLimitDays are the school's deviation from a type of
	// its Träger (#4710). SchoolLimitDays: omitted keeps the limit, null
	// removes it.
	Offered         *bool                         `json:"offered"`
	SchoolLimitDays common.DeferredJSON[*float64] `json:"school_limit_days" contract_refines:"The absence type handler already requires a number or null"`
}

// schoolLimit reads the optional limit: nil when omitted, a patch without
// days for null.
func (req UpdateAbsenceTypeRequest) schoolLimit() (*workforce.SchoolLimitPatch, error) {
	if !req.SchoolLimitDays.Present {
		return nil, nil
	}
	if req.SchoolLimitDays.Invalid != nil {
		return nil, &workforce.InvalidAbsenceTypeError{Reason: "school_limit_days must be a number or null"}
	}
	return &workforce.SchoolLimitPatch{Days: req.SchoolLimitDays.Value}, nil
}

// AbsenceTypeResponse is the wire format returned to clients. BaseType tells
// the client which standard type's calculation this art inherits, so the UI can
// say so instead of leaving the school guessing.
type AbsenceTypeResponse struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	BaseType         string `json:"base_type"`
	IsActive         bool   `json:"is_active"`
	AllowanceEnabled bool   `json:"allowance_enabled"`
	// CarryoverUntil is null when a rest expires on 31.12.
	CarryoverUntil *string `json:"carryover_until"`
	Requestable    bool    `json:"requestable"`
	// KeptByTraeger marks a type of the Träger (#4710): its name, Kontingent,
	// rest rule and Requestable come from the Träger. Offered and
	// SchoolLimitDays are the school's deviation for its own Einsätze.
	KeptByTraeger   bool     `json:"kept_by_traeger"`
	Offered         bool     `json:"offered"`
	SchoolLimitDays *float64 `json:"school_limit_days"`
}

// AllowanceSummaryResponse keeps database IDs as strings on the wire, matching
// every other frontend-facing int64 ID in the application.
type AllowanceSummaryResponse struct {
	StaffID       string  `json:"staff_id"`
	AbsenceTypeID string  `json:"absence_type_id"`
	Year          int     `json:"year"`
	EntitledDays  float64 `json:"entitled_days"`
	TakenDays     float64 `json:"taken_days"`
	ReservedDays  float64 `json:"reserved_days"`
	RemainingDays float64 `json:"remaining_days"`
	// ExpiresOn is the last day the rest can be booked; ExpiredDays is the
	// rest that was left when that day passed.
	ExpiresOn   string  `json:"expires_on"`
	ExpiredDays float64 `json:"expired_days"`
	// BookingDays is set on previews: what the booking takes from this year.
	BookingDays float64                 `json:"booking_days"`
	CarriedIn   *AllowanceCarryResponse `json:"carried_in"`
	// KeptByTraeger: the Träger keeps this account over all schools of the
	// person (#4710); the school reads it and does not change it.
	KeptByTraeger bool `json:"kept_by_traeger"`
	// Version is the token of the stored claim; PUT .../allowances/{staffId}
	// sends it back as expected_version (ADR 0311).
	Version string `json:"version"`
}

// AllowanceCarryResponse is the previous year's rest still usable in the
// summarized year.
type AllowanceCarryResponse struct {
	Year          int     `json:"year"`
	RemainingDays float64 `json:"remaining_days"`
	ExpiredDays   float64 `json:"expired_days"`
	ExpiresOn     string  `json:"expires_on"`
}

// AllowancePreviewResponse lists the yearly accounts a booking would use.
// Blocked is true when one of them would drop below zero or the booking
// passes the school's limit for a type of its Träger; BlockedBy names which
// ("allowance" or "school_limit").
type AllowancePreviewResponse struct {
	Years     []AllowanceSummaryResponse `json:"years"`
	Blocked   bool                       `json:"blocked"`
	BlockedBy string                     `json:"blocked_by,omitempty"`
}

// SetAllowanceRequest is the payload of PUT /{id}/allowances/{staffId}.
type SetAllowanceRequest struct {
	Year         int     `json:"year"`
	EntitledDays float64 `json:"entitled_days"`
	Reason       string  `json:"reason"`
	// ExpectedVersion is the version of the summary the form showed.
	ExpectedVersion string `json:"expected_version"`
}

func toAllowanceSummaryResponse(summary workforce.AbsenceTypeAllowanceSummary) AllowanceSummaryResponse {
	response := AllowanceSummaryResponse{
		StaffID:       strconv.FormatInt(summary.StaffID, 10),
		AbsenceTypeID: strconv.FormatInt(summary.AbsenceTypeID, 10),
		Year:          summary.Year,
		EntitledDays:  summary.EntitledDays,
		TakenDays:     summary.TakenDays,
		ReservedDays:  summary.ReservedDays,
		RemainingDays: summary.RemainingDays,
		ExpiresOn:     summary.ExpiresOn,
		ExpiredDays:   summary.ExpiredDays,
		BookingDays:   summary.BookingDays,
		KeptByTraeger: summary.KeptByTraeger,
		Version:       summary.Version,
	}
	if carried := summary.CarriedIn; carried != nil {
		response.CarriedIn = &AllowanceCarryResponse{
			Year: carried.Year, RemainingDays: carried.RemainingDays,
			ExpiredDays: carried.ExpiredDays, ExpiresOn: carried.ExpiresOn,
		}
	}
	return response
}

// OwnAllowanceResponse is one of the staff member's own Kontingente under
// /api/time-tracking/absence-allowances (#4971): the type's name next to the
// yearly account the Leitung reads under /{id}/allowances/{staffId}.
type OwnAllowanceResponse struct {
	Name string `json:"name"`
	AllowanceSummaryResponse
}

// ToOwnAllowanceResponses renders the staff member's own accounts in the
// wire form of the Leitung's view; the root binds it to /api/time-tracking.
func ToOwnAllowanceResponses(accounts []workforce.AbsenceTypeAllowanceAccount) []OwnAllowanceResponse {
	out := make([]OwnAllowanceResponse, 0, len(accounts))
	for _, account := range accounts {
		out = append(out, OwnAllowanceResponse{
			Name: account.AbsenceType.Name, AllowanceSummaryResponse: toAllowanceSummaryResponse(account.Summary),
		})
	}
	return out
}

func toAbsenceTypeResponse(t workforce.StaffAbsenceType) AbsenceTypeResponse {
	return AbsenceTypeResponse{
		ID:               strconv.FormatInt(t.ID, 10),
		Name:             t.Name,
		BaseType:         t.BaseType,
		IsActive:         t.IsActive,
		AllowanceEnabled: t.AllowanceEnabled,
		CarryoverUntil:   carryoverResponse(t.CarryoverUntil),
		Requestable:      t.Requestable,
		KeptByTraeger:    t.TraegerAbsenceTypeID != nil,
		Offered:          t.Offered,
		SchoolLimitDays:  t.SchoolLimitDays,
	}
}

func carryoverResponse(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func toAbsenceTypeResponses(types []workforce.StaffAbsenceType) []AbsenceTypeResponse {
	out := make([]AbsenceTypeResponse, 0, len(types))
	for _, t := range types {
		out = append(out, toAbsenceTypeResponse(t))
	}
	return out
}

// failureRule pairs a capability error with the failure kind the envelope
// renders for it. The table is the declarative form of the error
// classification; anything not listed is an internal failure.
type failureRule struct {
	Target error
	Kind   FailureKind
}

var failureRules = []failureRule{
	{Target: workforce.ErrAbsenceTypeNameTaken, Kind: FailureConflict},
	{Target: workforce.ErrAbsenceTypeNameReserved, Kind: FailureConflict},
	{Target: workforce.ErrAbsenceTypeInUse, Kind: FailureConflict},
	{Target: workforce.ErrAbsenceTypeAllowanceExceeded, Kind: FailureConflict},
	{Target: workforce.ErrAbsenceTypeKeptByTraeger, Kind: FailureConflict},
	{Target: workforce.ErrAbsenceTypeNotFound, Kind: FailureNotFound},
	{Target: workforce.ErrAbsenceTypeInvalid, Kind: FailureInvalid},
	{Target: workforce.ErrAbsenceTypeAllowanceInvalid, Kind: FailureInvalid},
}

// classify maps a capability error to its failure kind through failureRules.
func classify(err error) FailureKind {
	for _, rule := range failureRules {
		if errors.Is(err, rule.Target) {
			return rule.Kind
		}
	}
	return FailureInternal
}

func (rs *Resource) renderError(w http.ResponseWriter, r *http.Request, err error) {
	rs.runtime.Failure(w, r, classify(err), err)
}

func (rs *Resource) list(w http.ResponseWriter, r *http.Request) {
	types, err := rs.types.ListAbsenceTypes(r.Context())
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toAbsenceTypeResponses(types), "Abwesenheitsarten geladen")
}

func (rs *Resource) create(w http.ResponseWriter, r *http.Request) {
	var req CreateAbsenceTypeRequest
	if err := render.DecodeJSON(r.Body, &req); err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	saved, err := rs.types.CreateAbsenceType(r.Context(), workforce.CreateAbsenceType{
		Name: req.Name, AllowanceEnabled: req.AllowanceEnabled, CarryoverUntil: req.CarryoverUntil, Requestable: req.Requestable,
	})
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusCreated, toAbsenceTypeResponse(saved), "Abwesenheitsart erstellt")
}

func (rs *Resource) update(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	var req UpdateAbsenceTypeRequest
	if err := render.DecodeJSON(r.Body, &req); err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	limit, err := req.schoolLimit()
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	saved, err := rs.types.UpdateAbsenceType(r.Context(), workforce.UpdateAbsenceType{
		ID: id, Name: req.Name, IsActive: req.IsActive, AllowanceEnabled: req.AllowanceEnabled,
		CarryoverUntil: req.CarryoverUntil, Requestable: req.Requestable, Offered: req.Offered, SchoolLimit: limit,
	})
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toAbsenceTypeResponse(saved), "Abwesenheitsart aktualisiert")
}

func (rs *Resource) getAllowance(w http.ResponseWriter, r *http.Request) {
	typeID, staffID, year, err := rs.allowancePath(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	summary, err := rs.types.AllowanceSummary(r.Context(), staffID, typeID, year)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toAllowanceSummaryResponse(summary), "Kontingent geladen")
}

// previewAllowance answers with the yearly split of a planned booking. An
// exceeded allowance is part of the answer, not an error: the dialog shows
// which year falls short before anything is saved.
func (rs *Resource) previewAllowance(w http.ResponseWriter, r *http.Request) {
	typeID, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	staffID, err := rs.runtime.ParseIDParam(r, "staffId")
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	query := r.URL.Query()
	previews, err := rs.types.PreviewAllowanceBooking(
		r.Context(), staffID, typeID, query.Get("date_start"), query.Get("date_end"), query.Get("half_day") == "true",
	)
	blockedBy := previewBlock(err)
	if err != nil && blockedBy == "" {
		rs.renderError(w, r, err)
		return
	}
	response := AllowancePreviewResponse{Years: make([]AllowanceSummaryResponse, 0, len(previews)), Blocked: blockedBy != "", BlockedBy: blockedBy}
	for _, preview := range previews {
		response.Years = append(response.Years, toAllowanceSummaryResponse(preview))
	}
	rs.runtime.Success(w, r, http.StatusOK, response, "Vorschau berechnet")
}

func (rs *Resource) setAllowance(w http.ResponseWriter, r *http.Request) {
	typeID, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	staffID, err := rs.runtime.ParseIDParam(r, "staffId")
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	actorID, ok := rs.actor(w, r)
	if !ok {
		return
	}
	var req SetAllowanceRequest
	if err := render.DecodeJSON(r.Body, &req); err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	summary, err := rs.types.SetAllowance(r.Context(), workforce.SetAbsenceTypeAllowance{
		StaffID: staffID, AbsenceTypeID: typeID, Year: req.Year,
		EntitledDays: req.EntitledDays, Reason: req.Reason, ChangedBy: actorID,
		ExpectedVersion: &req.ExpectedVersion,
	})
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toAllowanceSummaryResponse(summary), "Kontingent gespeichert")
}

// actor resolves the staff member behind an allowance change or renders the
// failure: a caller without a staff record is refused (403), a failed lookup
// is the server's (500).
func (rs *Resource) actor(w http.ResponseWriter, r *http.Request) (int64, bool) {
	actorID, err := rs.runtime.ResolveActor(r.Context())
	if err == nil && actorID <= 0 {
		err = ErrNoStaffActor
	}
	if err != nil {
		kind := FailureInternal
		if errors.Is(err, ErrNoStaffActor) {
			kind = FailureForbidden
		}
		rs.runtime.Failure(w, r, kind, err)
		return 0, false
	}
	return actorID, true
}

// previewBlock names why a previewed booking is refused, "" when the error
// is no refusal of the booking.
func previewBlock(err error) string {
	switch {
	case errors.Is(err, workforce.ErrAbsenceTypeAllowanceExceeded):
		return "allowance"
	case errors.Is(err, workforce.ErrAbsenceTypeSchoolLimitExceeded):
		return "school_limit"
	}
	return ""
}

func (rs *Resource) allowancePath(r *http.Request) (int64, int64, int, error) {
	typeID, err := rs.runtime.ParseID(r)
	if err != nil {
		return 0, 0, 0, err
	}
	staffID, err := rs.runtime.ParseIDParam(r, "staffId")
	if err != nil {
		return 0, 0, 0, err
	}
	year, err := strconv.Atoi(r.URL.Query().Get("year"))
	if err != nil {
		return 0, 0, 0, err
	}
	return typeID, staffID, year, nil
}
