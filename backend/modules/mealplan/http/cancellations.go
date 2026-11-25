package mealplan

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
)

// MealCancellationResponse is a day without lunch (#7656) with the school's
// reason.
type MealCancellationResponse struct {
	Date   string `json:"date" contract:"date"`
	Reason string `json:"reason"`
}

// MealCancellationRequest cancels lunch on a day; Reason is required.
type MealCancellationRequest struct {
	Reason string `json:"reason"`
}

func (request *MealCancellationRequest) Bind(*http.Request) error {
	reason := strings.TrimSpace(request.Reason)
	if reason == "" {
		return errors.New("reason is required")
	}
	if utf8.RuneCountInString(reason) > mealplanModule.MaxCancellationReason {
		return errors.New("reason has at most 200 characters")
	}
	request.Reason = reason
	return nil
}

// cancellationRoutes serves the days without lunch: every reader of the
// meal plan sees them, only meals:manage enters or removes one. A write
// sends the content-free meal_plan_changed signal like a changed menu, so
// "Heute anders" reloads.
func (rs *Resource) cancellationRoutes(protected chi.Router, withTx Middleware) {
	if rs.runtime.Cancellations == nil {
		return
	}
	protected.With(rs.runtime.Permission(AccessRead), withTx).Get("/cancellations", rs.getCancellations)
	protected.With(rs.runtime.Permission(AccessWrite), rs.menuChanged(), withTx).Put("/days/{date}/cancellation", rs.cancelMeal)
	protected.With(rs.runtime.Permission(AccessWrite), rs.menuChanged(), withTx).Delete("/days/{date}/cancellation", rs.restoreMeal)
}

func (rs *Resource) getCancellations(w http.ResponseWriter, r *http.Request) {
	from, fromErr := mealplanModule.ParseDate(r.URL.Query().Get("from"))
	to, toErr := mealplanModule.ParseDate(r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		rs.runtime.InvalidRequest(w, r, errors.New("from and to must be in YYYY-MM-DD format"))
		return
	}
	cancellations, err := rs.runtime.Cancellations.MealCancellations(r.Context(), from, to)
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to load meal cancellations")
		return
	}
	responses := make([]MealCancellationResponse, 0, len(cancellations))
	for _, cancellation := range cancellations {
		responses = append(responses, MealCancellationResponse{Date: string(cancellation.Date), Reason: cancellation.Reason})
	}
	rs.runtime.Success(w, r, http.StatusOK, responses, "Meal cancellations retrieved successfully")
}

func (rs *Resource) cancelMeal(w http.ResponseWriter, r *http.Request) {
	date, ok := rs.dayParam(w, r)
	if !ok {
		return
	}
	request := &MealCancellationRequest{}
	if err := render.Bind(r, request); err != nil {
		rs.runtime.InvalidRequest(w, r, err)
		return
	}
	cancellation := mealplanModule.MealCancellation{Date: date, Reason: request.Reason}
	if err := rs.runtime.Cancellations.CancelMeal(r.Context(), cancellation); err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to cancel the meal")
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, MealCancellationResponse{Date: string(date), Reason: request.Reason}, "Meal cancelled")
}

func (rs *Resource) restoreMeal(w http.ResponseWriter, r *http.Request) {
	date, ok := rs.dayParam(w, r)
	if !ok {
		return
	}
	if err := rs.runtime.Cancellations.RestoreMeal(r.Context(), date); err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to restore the meal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
