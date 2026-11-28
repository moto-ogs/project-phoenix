package careplanhttp

import (
	context "context"
	errors "errors"
	http "net/http"
	"slices"
	strings "strings"

	render "github.com/go-chi/render"
	common "github.com/moto-ogs/project-phoenix/api/common"
	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The pickup person of one day (#7655): staff name who collects a child on
// one day, either a contact with a standing pickup permission or a one-time
// person by name only.

// PickupPersonRequest is the body of PUT /students/{id}/pickup-persons/{date}:
// exactly one of guardian_profile_id (a contact of the child with a pickup
// permission) and name (a one-time person).
type PickupPersonRequest struct {
	GuardianProfileID *ident.ID `json:"guardian_profile_id,omitempty"`
	Name              *string   `json:"name,omitempty"`
}

func (req *PickupPersonRequest) Bind(_ *http.Request) error {
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		req.Name = &trimmed
	}
	hasName := req.Name != nil && *req.Name != ""
	hasContact := req.GuardianProfileID != nil && *req.GuardianProfileID > 0
	if hasName == hasContact {
		return errors.New("exactly one of guardian_profile_id and name is required")
	}
	return nil
}

// PickupPersonResponse is who collects the child on one day.
type PickupPersonResponse struct {
	ID                ident.ID  `json:"id"`
	StudentID         ident.ID  `json:"student_id"`
	ExceptionDate     string    `json:"exception_date"`
	Name              string    `json:"name"`
	GuardianProfileID *ident.ID `json:"guardian_profile_id,omitempty"`
	// OneTime is true for a person without a standing pickup permission:
	// the staff check the ID card at the pickup.
	OneTime bool `json:"one_time"`
	// RequestedByGuardian is true for a day a family's one-day request
	// named (#8162).
	RequestedByGuardian bool `json:"requested_by_guardian"`
	// PermissionWithdrawn is true when the contact's pickup permission no
	// longer holds on the day (#8206): the name is no valid pickup person.
	PermissionWithdrawn bool   `json:"permission_withdrawn"`
	UpdatedAt           string `json:"updated_at"`
}

func mapPickupPersonToResponse(value careplan.PickupPerson) PickupPersonResponse {
	return PickupPersonResponse{
		ID: ident.ID(value.ID), StudentID: ident.ID(value.StudentID), ExceptionDate: string(value.ExceptionDate),
		Name: value.Name, GuardianProfileID: (*ident.ID)(value.GuardianProfileID), OneTime: value.OneTime(),
		RequestedByGuardian: value.RequestedByGuardian != nil, PermissionWithdrawn: value.PermissionWithdrawn,
		UpdatedAt: value.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// putStudentPickupPerson handles PUT /students/{id}/pickup-persons/{date}.
func (rs *Resource) putStudentPickupPerson(w http.ResponseWriter, r *http.Request) {
	student := rs.requirePickupWriteAccess(w, r, "set pickup persons")
	if student == nil {
		return
	}
	date, ok := departureExceptionDate(w, r)
	if !ok {
		return
	}
	req := &PickupPersonRequest{}
	if err := render.Bind(r, req); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	staffID, err := rs.getStaffIDFromJWT(r)
	if err != nil {
		renderScheduleAuthorError(w, r, err)
		return
	}
	person, guardian, err := rs.pickupPersonOf(r.Context(), student.ID, date, req)
	if err == nil {
		person, err = rs.PickupPersons.SetPickupPerson(r.Context(), person, staffID, guardian)
	}
	if err != nil {
		renderPickupPersonError(w, r, err)
		return
	}
	rs.announceDepartureChange(r, student.ID)
	common.Respond(w, r, http.StatusOK, mapPickupPersonToResponse(person), "Pickup person saved successfully")
}

// deleteStudentPickupPerson handles DELETE /students/{id}/pickup-persons/{date}.
// Deleting a day without a pickup person is a no-op.
func (rs *Resource) deleteStudentPickupPerson(w http.ResponseWriter, r *http.Request) {
	student := rs.requirePickupWriteAccess(w, r, "delete pickup persons")
	if student == nil {
		return
	}
	date, ok := departureExceptionDate(w, r)
	if !ok {
		return
	}
	deleted, err := rs.PickupPersons.DeletePickupPerson(r.Context(), student.ID, date)
	if err != nil {
		renderPickupPersonError(w, r, err)
		return
	}
	if deleted {
		rs.announceDepartureChange(r, student.ID)
	}
	common.Respond(w, r, http.StatusOK, nil, "Pickup person deleted successfully")
}

// pickupPersonOf builds the day value. A contact must be linked to the child
// with a pickup permission that holds on the day's weekday; its name is
// taken from the People Directory, never from the request.
func (rs *Resource) pickupPersonOf(ctx context.Context, studentID int64, date calendar.Date, req *PickupPersonRequest) (careplan.PickupPerson, *careplan.PickupPersonGuardianAuthorization, error) {
	person := careplan.PickupPerson{StudentID: studentID, ExceptionDate: careplan.Date(date.String())}
	if req.Name != nil && *req.Name != "" {
		person.Name = *req.Name
		return person, nil, nil
	}
	profileID := req.GuardianProfileID.Int64()
	contacts, err := rs.PeopleDirectory.ListStudentGuardians(ctx, studentID)
	if err != nil {
		return careplan.PickupPerson{}, nil, err
	}
	weekday, err := calendar.PlanWeekday(ctx, date)
	if err != nil {
		return careplan.PickupPerson{}, nil, err
	}
	for _, contact := range contacts {
		link := contact.Link
		if link.GuardianProfileID != profileID || !link.CanPickup ||
			link.PickupWeekdays != nil && !slices.Contains(link.PickupWeekdays, weekday) {
			continue
		}
		person.Name = strings.TrimSpace(contact.Guardian.FirstName + " " + contact.Guardian.LastName)
		person.GuardianProfileID = &profileID
		return person, &careplan.PickupPersonGuardianAuthorization{RelationshipID: link.ID, Weekday: weekday}, nil
	}
	return careplan.PickupPerson{}, nil, careplan.ErrPickupPersonGuardianNotAuthorized
}

func renderPickupPersonError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, careplan.ErrPickupPersonGuardianNotAuthorized):
		renderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeCarePickupPersonNotAuthorized))
	case errors.Is(err, careplan.ErrPickupPersonInvalid), errors.Is(err, careplan.ErrPickupPersonPastDate),
		errors.Is(err, careplan.ErrPickupPersonNotCareDay):
		renderError(w, r, common.ErrorInvalidRequest(err))
	default:
		renderError(w, r, common.ErrorInternalServer(err))
	}
}
