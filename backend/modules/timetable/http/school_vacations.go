package timetablehttp

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// SchoolVacations is the slice of the School Calendar the vacation routes
// drive: the school's reads and confirmations.
type SchoolVacations interface {
	schoolcalendar.SchoolVacations
}

// SchoolVacationsResponse is the wire shape of GET /school-vacations
// (#5345). SyncedAt is null while moto has not read the vacations of the
// state yet, so the page can tell "not read yet" from "no vacations".
type SchoolVacationsResponse struct {
	FederalState     string                          `json:"federal_state"`
	FederalStateName string                          `json:"federal_state_name"`
	SyncedAt         *time.Time                      `json:"synced_at"`
	Vacations        []schoolcalendar.SchoolVacation `json:"vacations"`
}

// SchoolVacationHintsResponse is the wire shape of GET
// /school-vacation-hints.
type SchoolVacationHintsResponse struct {
	Hints []timetable.SchoolVacationHint `json:"hints"`
}

// listSchoolVacations handles GET /api/timetable/school-vacations?from=&to=:
// the school vacations of the tenant's federal state with the school's
// confirmations. They are read from the stored sync, never fetched here.
func (rs *Resource) listSchoolVacations(w http.ResponseWriter, r *http.Request) {
	from, to, ok := parseDateWindow(w, r, schoolcalendar.MaxSchoolVacationWindowDays)
	if !ok {
		return
	}
	if rs.SchoolVacations == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("school vacation service is not configured")))
		return
	}
	list, err := rs.SchoolVacations.TenantSchoolVacations(r.Context(), from.String(), to.String())
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("Schulferien konnten nicht gelesen werden", err))
		return
	}
	vacations := list.Vacations
	if vacations == nil {
		vacations = []schoolcalendar.SchoolVacation{}
	}
	common.Respond(w, r, http.StatusOK, SchoolVacationsResponse{
		FederalState: list.Region.Code, FederalStateName: list.Region.Name, SyncedAt: list.SyncedAt, Vacations: vacations,
	}, "School vacations retrieved successfully")
}

// listSchoolVacationHints handles GET /api/timetable/school-vacation-hints:
// the coming vacations of the school's state with planned Regeltermine the
// school has neither closed nor confirmed.
func (rs *Resource) listSchoolVacationHints(w http.ResponseWriter, r *http.Request) {
	if rs.SchoolVacationHints == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("school vacation hints are not configured")))
		return
	}
	hints, err := rs.SchoolVacationHints.SchoolVacationHints(r.Context())
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("Ferienhinweise konnten nicht gelesen werden", err))
		return
	}
	common.Respond(w, r, http.StatusOK, SchoolVacationHintsResponse{Hints: hints}, "School vacation hints retrieved successfully")
}

// schoolVacationAcknowledgementRequest names the vacation window the school
// confirms as planned care.
type schoolVacationAcknowledgementRequest struct {
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

func (req *schoolVacationAcknowledgementRequest) Bind(_ *http.Request) error {
	if req.StartDate == "" || req.EndDate == "" {
		return errors.New("start_date and end_date are required")
	}
	return nil
}

// acknowledgeSchoolVacation handles POST
// /api/timetable/school-vacation-hints/acknowledgements: the school plans
// care in this vacation window on purpose, so its hint goes away for the
// whole school. No Termin changes.
func (rs *Resource) acknowledgeSchoolVacation(w http.ResponseWriter, r *http.Request) {
	if rs.SchoolVacations == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("school vacation service is not configured")))
		return
	}
	req := &schoolVacationAcknowledgementRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	err := rs.SchoolVacations.AcknowledgeSchoolVacation(r.Context(), schoolcalendar.SchoolVacationAcknowledgement{
		StartDate: req.StartDate, EndDate: req.EndDate, AccountID: sessiontoken.ActorAccountIDFromCtx(r.Context()),
	})
	switch {
	case errors.Is(err, schoolcalendar.ErrInvalidSchoolVacationWindow):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, schoolcalendar.ErrSchoolVacationNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTimetableSchoolVacationNotFound))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServerWrap("Die Ferien konnten nicht bestätigt werden", err))
	default:
		common.Respond(w, r, http.StatusOK, SchoolVacationAcknowledgedResponse{Acknowledged: true}, "School vacation acknowledged")
	}
}
