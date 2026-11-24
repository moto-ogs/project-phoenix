package worktimemodels

import (
	"net/http"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// StaffFactResponse tells the assignment dialog (#6921) what decides whether
// and from when a template may be assigned to one staff member. Members
// without any fact are absent.
type StaffFactResponse struct {
	StaffID           ident.ID  `json:"staff_id"`
	WorkTimeModelID   *ident.ID `json:"work_time_model_id"`
	HasSchedule       bool      `json:"has_schedule"`
	SollKeptByTraeger bool      `json:"soll_kept_by_traeger"`
	ClosedThrough     *string   `json:"closed_through"`
}

// AssignRequest names the staff members a template is assigned to and the
// first day of their new schedule (empty: today).
type AssignRequest struct {
	StaffIDs  []ident.ID `json:"staff_ids"`
	ValidFrom string     `json:"valid_from"`
}

// AssignResponse reports who now carries the template and since when.
type AssignResponse struct {
	AssignedStaffIDs  []ident.ID `json:"assigned_staff_ids"`
	UnchangedStaffIDs []ident.ID `json:"unchanged_staff_ids"`
	ValidFrom         string     `json:"valid_from"`
}

// staffFacts handles GET /api/work-time-models/staff-facts.
func (rs *Resource) staffFacts(w http.ResponseWriter, r *http.Request) {
	facts, err := rs.catalog.StaffWorkTimeFacts(r.Context())
	if err != nil {
		rs.renderCapabilityError(w, r, err)
		return
	}
	out := make([]StaffFactResponse, 0, len(facts))
	for _, fact := range facts {
		response := StaffFactResponse{
			StaffID: ident.ID(fact.StaffID), WorkTimeModelID: (*ident.ID)(fact.WorkTimeModelID),
			HasSchedule: fact.HasSchedule, SollKeptByTraeger: fact.SollKeptByTraeger,
		}
		if fact.ClosedThrough != "" {
			closed := fact.ClosedThrough
			response.ClosedThrough = &closed
		}
		out = append(out, response)
	}
	rs.runtime.Success(w, r, http.StatusOK, out, "Staff work-time facts retrieved")
}

// assign handles POST /api/work-time-models/{id}/assignments. The capability
// writes every schedule in one unit of work; the time-account views are
// invalidated only after it committed and only when a Soll changed.
func (rs *Resource) assign(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	var req AssignRequest
	if err := wire.DecodeAndDrain(r.Body, &req); err != nil {
		rs.runtime.Failure(w, r, FailureInvalid, err)
		return
	}
	result, err := rs.catalog.AssignWorkTimeModel(r.Context(), workforce.AssignWorkTimeModel{
		ModelID: id, StaffIDs: ident.Int64s(req.StaffIDs), ValidFrom: req.ValidFrom,
	})
	if err != nil {
		rs.renderCapabilityError(w, r, err)
		return
	}
	if len(result.Assigned) > 0 {
		rs.runtime.NotifyChanged(r.Context())
	}
	rs.runtime.Success(w, r, http.StatusOK, AssignResponse{
		AssignedStaffIDs: ident.IDs(result.Assigned), UnchangedStaffIDs: ident.IDs(result.Unchanged), ValidFrom: result.ValidFrom,
	}, "Work time model assigned")
}
