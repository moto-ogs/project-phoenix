package traegerstaff

import (
	"errors"
	"net/http"

	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// HireRequest is „Person einstellen“ (#7206): the person, the contract and
// the Soll Monday to Friday of each Einsatzort.
type HireRequest struct {
	FirstName       string       `json:"first_name"`
	LastName        string       `json:"last_name"`
	Birthday        string       `json:"birthday"`
	Email           *string      `json:"email"`
	Phone           *string      `json:"phone"`
	PersonnelNumber *string      `json:"personnel_number"`
	Contract        HireContract `json:"contract"`
	Sites           []HireSite   `json:"sites"`
	// ConfirmDuplicate hires although a person with this name and birthday
	// exists: the Personalverwaltung says these are two people.
	ConfirmDuplicate bool `json:"confirm_duplicate"`
}

// HireContract is the contract a hire starts with.
type HireContract struct {
	Kind     string         `json:"kind"`
	StartsOn calendar.Date  `json:"starts_on"`
	EndsOn   *calendar.Date `json:"ends_on"`
}

// HireSite is one Einsatzort of a hire with its Soll Monday to Friday.
type HireSite struct {
	SchoolID       ident.ID `json:"school_id"`
	WeekdayMinutes []int    `json:"weekday_minutes"`
}

func (req *HireRequest) Bind(*http.Request) error { return nil }

func (req *HireRequest) toInput() workforce.TraegerStaffHireInput {
	input := workforce.TraegerStaffHireInput{
		FirstName: req.FirstName, LastName: req.LastName, Birthday: req.Birthday, Email: req.Email, Phone: req.Phone,
		PersonnelNumber: req.PersonnelNumber, Kind: req.Contract.Kind, StartsOn: req.Contract.StartsOn, EndsOn: req.Contract.EndsOn,
		ConfirmDuplicate: req.ConfirmDuplicate,
	}
	for _, site := range req.Sites {
		input.Sites = append(input.Sites, workforce.TraegerStaffHireSite{SchoolID: int64(site.SchoolID), WeekdayMinutes: site.WeekdayMinutes})
	}
	return input
}

func (rs *RecordsResource) hire(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	req := &HireRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceTraegerStaffHireInvalid))
		return
	}
	detail, err := rs.hires.Hire(r.Context(), session, req.toInput())
	if err != nil {
		renderHireError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, detail, "Person hired successfully")
}

// renderHireError maps the refusals of a hire onto their codes. A held-back
// hire names where the person may exist already in details, so the
// Personalverwaltung can decide; an incomplete one names what it left
// behind, so nobody hires the person a second time.
func renderHireError(w http.ResponseWriter, r *http.Request, err error) {
	if hire, ok := errors.AsType[*workforce.TraegerStaffHireError](err); ok {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerStaffHireInvalid, hire.Field))
		return
	}
	if duplicate, ok := errors.AsType[*workforce.TraegerStaffHireDuplicateError](err); ok {
		matches := make([]hireMatchResponse, 0, len(duplicate.Matches))
		for _, match := range duplicate.Matches {
			matches = append(matches, hireMatchResponse{
				Kind: match.Kind, RecordID: ident.ID(match.RecordID),
				SchoolID: ident.ID(match.SchoolID), SchoolName: match.SchoolName, StaffID: ident.ID(match.StaffID),
				FirstName: match.FirstName, LastName: match.LastName, Reasons: match.Reasons,
			})
		}
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerStaffHireDuplicate, map[string]any{"matches": matches}))
		return
	}
	if incomplete, ok := errors.AsType[*workforce.TraegerStaffHireIncompleteError](err); ok {
		details := map[string]any{"schools": incomplete.Schools}
		if incomplete.RecordID > 0 {
			details["staff_record_id"] = ident.ID(incomplete.RecordID)
		}
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerStaffHireIncomplete, details))
		return
	}
	renderContractError(w, r, err)
}

type hireMatchResponse struct {
	Kind       string   `json:"kind"`
	RecordID   ident.ID `json:"staff_record_id,omitzero"`
	SchoolID   ident.ID `json:"school_id,omitzero"`
	SchoolName string   `json:"school_name,omitempty"`
	StaffID    ident.ID `json:"staff_id,omitzero"`
	FirstName  string   `json:"first_name"`
	LastName   string   `json:"last_name"`
	Reasons    []string `json:"reasons"`
}
