package traegerstaff

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// The Stundenkonto of a record over all schools and its Monatsabschluss
// (#4711): GET reads a month, the two POSTs close and reopen it. Both writes
// carry a mandatory reason, like the school's close.

func (rs *RecordsResource) timeAccountRoutes(staff chi.Router) {
	staff.Get("/{id}/time-account", rs.timeAccount)
	staff.Post("/{id}/time-account/close", rs.closeTimeAccountMonth)
	staff.Post("/{id}/time-account/reopen", rs.reopenTimeAccountMonth)
}

// timeAccount serves GET /traeger/staff-records/{id}/time-account: the
// month ?year=&month= (default: this month, which the application knows).
func (rs *RecordsResource) timeAccount(w http.ResponseWriter, r *http.Request) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	year, month, err := timeAccountMonth(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	account, err := rs.timeAccounts.TimeAccount(r.Context(), session, id, year, month)
	if err != nil {
		renderTimeAccountError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, account, "Time account retrieved successfully")
}

func timeAccountMonth(r *http.Request) (int, int, error) {
	var year, month int
	for _, field := range []struct {
		name  string
		value *int
	}{{"year", &year}, {"month", &month}} {
		raw := r.URL.Query().Get(field.name)
		if raw == "" {
			continue
		}
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return 0, 0, fmt.Errorf("%s must be a number", field.name)
		}
		*field.value = parsed
	}
	return year, month, nil
}

// monthChangeRequest closes or reopens one month with its reason.
type monthChangeRequest struct {
	Year   int    `json:"year"`
	Month  int    `json:"month"`
	Reason string `json:"reason"`
}

var errReasonRequired = errors.New("a reason is required")

func (req *monthChangeRequest) Bind(*http.Request) error {
	if strings.TrimSpace(req.Reason) == "" {
		return errReasonRequired
	}
	return nil
}

func (rs *RecordsResource) closeTimeAccountMonth(w http.ResponseWriter, r *http.Request) {
	rs.changeTimeAccountMonth(w, r, rs.timeAccounts.CloseTimeAccountMonth, "Month closed successfully")
}

func (rs *RecordsResource) reopenTimeAccountMonth(w http.ResponseWriter, r *http.Request) {
	rs.changeTimeAccountMonth(w, r, rs.timeAccounts.ReopenTimeAccountMonth, "Month reopened successfully")
}

func (rs *RecordsResource) changeTimeAccountMonth(w http.ResponseWriter, r *http.Request,
	change func(context.Context, workforce.TraegerStaffActor, int64, workforce.TraegerMonthChange) (workforce.TraegerTimeAccount, error),
	message string,
) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	req := &monthChangeRequest{}
	if err := render.Bind(r, req); err != nil {
		// Only the missing reason belongs to a field; a broken body does not.
		if errors.Is(err, errReasonRequired) {
			common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeGeneralInput, "reason"))
		} else {
			common.RenderError(w, r, common.ErrorInvalidRequest(err))
		}
		return
	}
	account, err := change(r.Context(), session, id, workforce.TraegerMonthChange{Year: req.Year, Month: req.Month, Reason: req.Reason})
	if err != nil {
		renderTimeAccountError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, account, message)
}

// renderTimeAccountError maps the refusals of the Stundenkonto onto their
// codes; a refusal of one school names it in details.
func renderTimeAccountError(w http.ResponseWriter, r *http.Request, err error) {
	details := map[string]any{}
	var school *workforce.TraegerSchoolMonthError
	if errors.As(err, &school) {
		details["school"], details["school_id"] = school.SchoolName, school.SchoolID
	}
	switch {
	case errors.Is(err, workforce.ErrLaterMonthClosed) && school != nil:
		details["month"] = laterMonthLabel(school.LaterMonth)
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerMonthLaterClosed, details))
	case errors.Is(err, workforce.ErrLaterMonthClosed):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeWorkforceLaterMonthClosed))
	case errors.Is(err, workforce.ErrMonthClosedBySchool):
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerMonthClosedBySchool, details))
	case errors.Is(err, workforce.ErrMonthNotKeptByTraeger):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeWorkforceTraegerMonthNotKept))
	case errors.Is(err, workforce.ErrMonthNotClosable):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceMonthNotClosable))
	case errors.Is(err, workforce.ErrMonthNotClosed):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeWorkforceMonthNotClosed))
	case errors.Is(err, workforce.ErrMonthCloseInvalid):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	default:
		renderError(w, r, err)
	}
}

var germanMonthNames = [...]string{"Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"}

// laterMonthLabel turns the YYYY-MM of a later closed month into „März 2026“.
func laterMonthLabel(month string) string {
	var year, number int
	if _, err := fmt.Sscanf(month, "%04d-%02d", &year, &number); err != nil || number < 1 || number > 12 {
		return month
	}
	return fmt.Sprintf("%s %d", germanMonthNames[number-1], year)
}
