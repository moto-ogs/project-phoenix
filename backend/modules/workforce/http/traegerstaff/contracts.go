package traegerstaff

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Arbeitsverträge of a record (#4706) at
// /traeger/staff-records/{id}/contracts. Each write answers with the record
// as GET /{id} shows it.

func (rs *RecordsResource) contractRoutes(staff chi.Router) {
	staff.Post("/{id}/contracts", rs.createContract)
	staff.Put("/{id}/contracts/{contractId}", rs.updateContract)
	staff.Delete("/{id}/contracts/{contractId}", rs.deleteContract)
	staff.Post("/{id}/contracts/{contractId}/soll", rs.changeContractSoll)
	staff.Post("/{id}/contracts/{contractId}/holiday-weeks", rs.addHolidayWeeks)
	staff.Delete("/{id}/contracts/{contractId}/holiday-weeks/{schoolId}/{weekStart}", rs.deleteHolidayWeek)
}

// siteSollPayload is the Soll of one Einsatzort, Monday to Friday in minutes.
type siteSollPayload struct {
	SchoolID       common.JSONID `json:"school_id"`
	StaffID        common.JSONID `json:"staff_id"`
	WeekdayMinutes []int         `json:"weekday_minutes"`
}

func sitesInput(sites []siteSollPayload) []workforce.TraegerContractSiteSoll {
	result := make([]workforce.TraegerContractSiteSoll, 0, len(sites))
	for _, site := range sites {
		result = append(result, workforce.TraegerContractSiteSoll{
			TraegerContractSite: workforce.TraegerContractSite{SchoolID: int64(site.SchoolID), StaffID: int64(site.StaffID)},
			WeekdayMinutes:      site.WeekdayMinutes,
		})
	}
	return result
}

type createContractRequest struct {
	Kind     string            `json:"kind"`
	StartsOn calendar.Date     `json:"starts_on"`
	EndsOn   *calendar.Date    `json:"ends_on"`
	Pool     bool              `json:"pool"`
	Sites    []siteSollPayload `json:"sites"`
}

func (req *createContractRequest) Bind(*http.Request) error {
	if req.StartsOn == "" {
		return errors.New("starts_on is required")
	}
	return nil
}

func (rs *RecordsResource) createContract(w http.ResponseWriter, r *http.Request) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	req := &createContractRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerContractInvalid, "starts_on"))
		return
	}
	detail, err := rs.contracts.CreateContract(r.Context(), session, id, workforce.TraegerContractInput{
		Kind: req.Kind, StartsOn: req.StartsOn, EndsOn: req.EndsOn, Pool: req.Pool, Sites: sitesInput(req.Sites),
	})
	respondContract(w, r, http.StatusCreated, detail, err, "Contract created successfully")
}

type updateContractRequest struct {
	Kind   string         `json:"kind"`
	EndsOn *calendar.Date `json:"ends_on"`
	Pool   bool           `json:"pool"`
}

func (req *updateContractRequest) Bind(*http.Request) error { return nil }

func (rs *RecordsResource) updateContract(w http.ResponseWriter, r *http.Request) {
	session, id, contractID, ok := actorRecordAndContract(w, r)
	if !ok {
		return
	}
	req := &updateContractRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerContractInvalid, "kind"))
		return
	}
	detail, err := rs.contracts.UpdateContract(r.Context(), session, id, contractID, workforce.TraegerContractTermsInput{Kind: req.Kind, EndsOn: req.EndsOn, Pool: req.Pool})
	respondContract(w, r, http.StatusOK, detail, err, "Contract updated successfully")
}

func (rs *RecordsResource) deleteContract(w http.ResponseWriter, r *http.Request) {
	session, id, contractID, ok := actorRecordAndContract(w, r)
	if !ok {
		return
	}
	detail, err := rs.contracts.DeleteContract(r.Context(), session, id, contractID)
	respondContract(w, r, http.StatusOK, detail, err, "Contract deleted successfully")
}

type contractSollRequest struct {
	ValidFrom calendar.Date     `json:"valid_from"`
	Sites     []siteSollPayload `json:"sites"`
}

func (req *contractSollRequest) Bind(*http.Request) error {
	if req.ValidFrom == "" {
		return errors.New("valid_from is required")
	}
	return nil
}

func (rs *RecordsResource) changeContractSoll(w http.ResponseWriter, r *http.Request) {
	session, id, contractID, ok := actorRecordAndContract(w, r)
	if !ok {
		return
	}
	req := &contractSollRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerContractInvalid, "valid_from"))
		return
	}
	detail, err := rs.contracts.ChangeContractSoll(r.Context(), session, id, contractID, workforce.TraegerContractSollInput{
		ValidFrom: req.ValidFrom, Sites: sitesInput(req.Sites),
	})
	respondContract(w, r, http.StatusOK, detail, err, "Contract Soll changed successfully")
}

type holidayWeeksRequest struct {
	SchoolID       common.JSONID `json:"school_id"`
	StaffID        common.JSONID `json:"staff_id"`
	FromWeek       calendar.Date `json:"from_week"`
	ToWeek         calendar.Date `json:"to_week"`
	WeekdayMinutes []int         `json:"weekday_minutes"`
}

func (req *holidayWeeksRequest) Bind(*http.Request) error {
	if req.FromWeek.IsZero() || req.ToWeek.IsZero() {
		return errors.New("from_week and to_week are required")
	}
	return nil
}

func (rs *RecordsResource) addHolidayWeeks(w http.ResponseWriter, r *http.Request) {
	session, id, contractID, ok := actorRecordAndContract(w, r)
	if !ok {
		return
	}
	req := &holidayWeeksRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerContractInvalid, "from_week"))
		return
	}
	detail, err := rs.contracts.AddHolidayWeeks(r.Context(), session, id, contractID, workforce.TraegerHolidayWeeksInput{
		TraegerContractSite: workforce.TraegerContractSite{SchoolID: int64(req.SchoolID), StaffID: int64(req.StaffID)},
		FromWeek:            req.FromWeek, ToWeek: req.ToWeek, WeekdayMinutes: req.WeekdayMinutes,
	})
	respondContract(w, r, http.StatusCreated, detail, err, "Holiday weeks added successfully")
}

func (rs *RecordsResource) deleteHolidayWeek(w http.ResponseWriter, r *http.Request) {
	session, id, contractID, ok := actorRecordAndContract(w, r)
	if !ok {
		return
	}
	schoolID, ok := common.ParseInt64IDWithError(w, r, "schoolId", "invalid school ID")
	if !ok {
		return
	}
	weekStart, err := calendar.ParseDate(chi.URLParam(r, "weekStart"))
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerContractInvalid, "week_start"))
		return
	}
	detail, err := rs.contracts.DeleteHolidayWeek(r.Context(), session, id, contractID, workforce.TraegerContractSite{SchoolID: schoolID}, weekStart)
	respondContract(w, r, http.StatusOK, detail, err, "Holiday week deleted successfully")
}

func actorRecordAndContract(w http.ResponseWriter, r *http.Request) (workforce.TraegerStaffActor, int64, int64, bool) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return workforce.TraegerStaffActor{}, 0, 0, false
	}
	contractID, ok := common.ParseInt64IDWithError(w, r, "contractId", "invalid contract ID")
	return session, id, contractID, ok
}

func respondContract(w http.ResponseWriter, r *http.Request, status int, detail workforce.TraegerStaffRecordDetail, err error, message string) {
	if err != nil {
		renderContractError(w, r, err)
		return
	}
	common.Respond(w, r, status, detail, message)
}

// renderContractError maps the contract refusals onto their codes; the
// school and the first open day travel in details for the catalog text.
func renderContractError(w http.ResponseWriter, r *http.Request, err error) {
	contractErr, ok := errors.AsType[*workforce.TraegerContractError](err)
	if !ok {
		if errors.Is(err, workforce.ErrTraegerContractNotFound) {
			common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeWorkforceTraegerContractNotFound))
			return
		}
		renderError(w, r, err)
		return
	}
	details := map[string]any{"field": contractErr.Field, "school": contractErr.SchoolName, "school_id": contractErr.SchoolID}
	if !contractErr.Day.IsZero() {
		details["day"] = contractErr.Day.Format("02.01.2006")
		details["date"] = contractErr.Day.String()
	}
	switch {
	case errors.Is(err, workforce.ErrTraegerContractMonthClosed):
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerContractMonthClosed, details))
	case errors.Is(err, workforce.ErrTraegerContractOverlap):
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerContractOverlap, details))
	case errors.Is(err, workforce.ErrTraegerHolidayWeekSchoolOverride):
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerHolidayWeekSchoolOverride, details))
	default:
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerContractInvalid, contractErr.Field))
	}
}
