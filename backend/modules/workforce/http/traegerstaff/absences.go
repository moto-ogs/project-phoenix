package traegerstaff

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// AbsenceTypesResource serves the Abwesenheitsarten of the session's Träger
// at /traeger/absence-types (#4710). Every route needs the Träger right
// „Personal“; the owner opens the transactions itself (ADR 0105).
type AbsenceTypesResource struct {
	types        workforce.TraegerAbsenceTypes
	requireStaff common.Middleware
}

// NewAbsenceTypesResource builds the resource; the root binds requireStaff
// to the Träger right traeger_staff:manage.
func NewAbsenceTypesResource(types workforce.TraegerAbsenceTypes, requireStaff common.Middleware) *AbsenceTypesResource {
	if types == nil || requireStaff == nil {
		panic("workforce traeger absence types: the types and the right check are required")
	}
	return &AbsenceTypesResource{types: types, requireStaff: requireStaff}
}

// TraegerRouter returns the routes mounted at /traeger/absence-types.
func (rs *AbsenceTypesResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/", rs.list)
		staff.Post("/", rs.create)
		staff.Put("/{id}", rs.update)
	})
	return r
}

// AbsenceTypeRequest is the whole type; an update replaces every field.
type AbsenceTypeRequest struct {
	Name             string  `json:"name"`
	AllowanceEnabled bool    `json:"allowance_enabled"`
	StandardDays     float64 `json:"standard_days"`
	CarryoverUntil   string  `json:"carryover_until"`
	Requestable      bool    `json:"requestable"`
	IsActive         *bool   `json:"is_active"`
}

func (req *AbsenceTypeRequest) Bind(*http.Request) error { return nil }

func (req *AbsenceTypeRequest) toInput() workforce.TraegerAbsenceTypeInput {
	active := req.IsActive == nil || *req.IsActive
	return workforce.TraegerAbsenceTypeInput{
		Name: req.Name, AllowanceEnabled: req.AllowanceEnabled, StandardDays: req.StandardDays,
		CarryoverUntil: req.CarryoverUntil, Requestable: req.Requestable, IsActive: active,
	}
}

func (rs *AbsenceTypesResource) list(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	list, err := rs.types.ListAbsenceTypes(r.Context(), session)
	if err != nil {
		renderAbsenceError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, list, "Absence types retrieved successfully")
}

func (rs *AbsenceTypesResource) create(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	req := &AbsenceTypeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceTraegerAbsenceTypeInvalid))
		return
	}
	saved, err := rs.types.CreateAbsenceType(r.Context(), session, req.toInput())
	if err != nil {
		renderAbsenceError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, saved, "Absence type created successfully")
}

func (rs *AbsenceTypesResource) update(w http.ResponseWriter, r *http.Request) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	req := &AbsenceTypeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceTraegerAbsenceTypeInvalid))
		return
	}
	saved, err := rs.types.UpdateAbsenceType(r.Context(), session, id, req.toInput())
	if err != nil {
		renderAbsenceError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, saved, "Absence type updated successfully")
}

// absenceAccounts serves GET /traeger/staff-records/{id}/absence-accounts:
// the Kontingente of the record in ?year= (default: this year).
func (rs *RecordsResource) absenceAccounts(w http.ResponseWriter, r *http.Request) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	year := rs.today().Year()
	if raw := r.URL.Query().Get("year"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			common.RenderError(w, r, common.ErrorInvalidRequest(err))
			return
		}
		year = parsed
	}
	accounts, err := rs.absences.AbsenceAccounts(r.Context(), session, id, year)
	if err != nil {
		renderAbsenceError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, accounts, "Absence accounts retrieved successfully")
}

// AbsenceAllowanceRequest sets the days of one person, type and year.
type AbsenceAllowanceRequest struct {
	Year         int     `json:"year"`
	EntitledDays float64 `json:"entitled_days"`
	Reason       string  `json:"reason"`
}

func (req *AbsenceAllowanceRequest) Bind(*http.Request) error { return nil }

// setAbsenceAllowance serves PUT
// /traeger/staff-records/{id}/absence-accounts/{typeId}.
func (rs *RecordsResource) setAbsenceAllowance(w http.ResponseWriter, r *http.Request) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	typeID, ok := common.ParseInt64IDWithError(w, r, "typeId", "invalid absence type ID")
	if !ok {
		return
	}
	req := &AbsenceAllowanceRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	err := rs.absences.SetAbsenceAllowance(r.Context(), session, workforce.SetTraegerAbsenceAllowance{
		RecordID: id, AbsenceTypeID: typeID, Year: req.Year, EntitledDays: req.EntitledDays, Reason: req.Reason,
	})
	if err != nil {
		renderAbsenceError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, IDResponse{ID: typeID}, "Absence allowance saved successfully")
}

func renderAbsenceError(w http.ResponseWriter, r *http.Request, err error) {
	if invalid, ok := errors.AsType[*workforce.TraegerAbsenceTypeError](err); ok {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(invalid, common.CodeWorkforceTraegerAbsenceTypeInvalid))
		return
	}
	common.RenderError(w, r, absenceErrors(err))
}

var absenceErrors = common.RulesRenderer([]common.ErrorRule{
	{Target: workforce.ErrTraegerStaffNotReleased, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerStaffNotReleased)},
	{Target: workforce.ErrTraegerStaffRecordNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerStaffRecordNotFound)},
	{Target: workforce.ErrTraegerAbsenceTypeNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerAbsenceTypeNotFound)},
	{Target: workforce.ErrTraegerAbsenceTypeNameTaken, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerAbsenceTypeNameTaken)},
	{Target: workforce.ErrTraegerAbsenceTypeInUse, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerAbsenceTypeInUse)},
	{Target: workforce.ErrTraegerAbsenceAllowanceBelowBooked, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerAbsenceAllowanceBelowBooked)},
	{Target: workforce.ErrAbsenceTypeAllowanceInvalid, Render: common.ErrorInvalidRequest},
}, common.ErrorInternalServer)
