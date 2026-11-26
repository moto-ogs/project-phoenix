// Package mealplan exposes the staff Meal Plan HTTP adapter.
package mealplan

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"context"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type Middleware = func(http.Handler) http.Handler

type Access uint8

const (
	AccessRead Access = iota + 1
	AccessWrite
	AccessParticipants
	// AccessRegister changes a child's registration for the school (#3873).
	AccessRegister
	// AccessDailyParticipants reads the child list needed to change registrations.
	AccessDailyParticipants
)

type ExportFile struct {
	Data        []byte
	ContentType string
	Filename    string
}

type Runtime struct {
	Protected      func(chi.Router, func(chi.Router, Middleware))
	Permission     func(Access) Middleware
	Success        func(http.ResponseWriter, *http.Request, int, any, string)
	InvalidRequest func(http.ResponseWriter, *http.Request, error)
	// ParseIDParam reads an int64 path parameter: api/common.ParseIDParam.
	ParseIDParam  func(*http.Request, string) (int64, error)
	ModuleFailure func(http.ResponseWriter, *http.Request, error, string)
	// RenderList renders a list export as PDF or XLSX.
	RenderList func(mealplanModule.ListExport, string) (ExportFile, error)
	// CurrentAccountID is the staff account of the request, recorded on a
	// school's change.
	CurrentAccountID func(context.Context) int64
	// Allowed reports whether the caller passes an access level, for a
	// response part only some readers see.
	Allowed func(context.Context, Access) bool
	// MenuChanged wraps the writes of a day outside their transaction, so it
	// sees the committed answer: the root binds it to the content-free
	// meal_plan_changed signal (#7666). Nil sends none.
	MenuChanged Middleware
	// Cancellations is the school's entry of the days without lunch
	// (#7656). Nil leaves its routes out, as in tests of the menu alone.
	Cancellations mealplanModule.MealCancellations
}

type Resource struct {
	module  mealplanModule.Capability
	runtime Runtime
}

func NewResource(module mealplanModule.Capability, runtime Runtime) *Resource {
	if module == nil || runtime.Protected == nil || runtime.Permission == nil || runtime.Success == nil || runtime.InvalidRequest == nil || runtime.ModuleFailure == nil || runtime.RenderList == nil || runtime.CurrentAccountID == nil || runtime.Allowed == nil {
		panic("meal plan HTTP: all dependencies are required")
	}
	return &Resource{module: module, runtime: runtime}
}

// menuChanged is the root's signal around a write of a day, or a pass-through.
func (rs *Resource) menuChanged() Middleware {
	if rs.runtime.MenuChanged == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return rs.runtime.MenuChanged
}

func (rs *Resource) Router() chi.Router {
	router := chi.NewRouter()
	router.Use(render.SetContentType(render.ContentTypeJSON))
	rs.runtime.Protected(router, func(protected chi.Router, withTx Middleware) {
		protected.With(rs.runtime.Permission(AccessRead), withTx).Get("/", rs.getWeek)
		protected.With(rs.runtime.Permission(AccessRead), withTx).Get("/days", rs.getDays)
		protected.With(rs.runtime.Permission(AccessWrite), rs.menuChanged(), withTx).Put("/days/{date}", rs.saveDay)
		protected.With(rs.runtime.Permission(AccessWrite), rs.menuChanged(), withTx).Put("/{date}", rs.setDay)
		protected.With(rs.runtime.Permission(AccessWrite), rs.menuChanged(), withTx).Delete("/{date}", rs.deleteDay)
		protected.With(rs.runtime.Permission(AccessDailyParticipants), withTx).Get("/participants", rs.getParticipants)
		protected.With(rs.runtime.Permission(AccessParticipants), withTx).Get("/participants/export", rs.exportParticipants)
		protected.With(rs.runtime.Permission(AccessParticipants), withTx).Get("/participants/week", rs.getWeeklyParticipants)
		protected.With(rs.runtime.Permission(AccessParticipants), withTx).Get("/participants/week/export", rs.exportWeeklyParticipants)
		protected.With(rs.runtime.Permission(AccessRead), withTx).Get("/orders", rs.getOrders)
		protected.With(rs.runtime.Permission(AccessParticipants), withTx).Get("/orders/month/export", rs.exportMonth)
		protected.With(rs.runtime.Permission(AccessRegister), withTx).Get("/participation/{studentId}", rs.getChildParticipation)
		protected.With(rs.runtime.Permission(AccessRegister), withTx).Put("/participation/{studentId}/days/{date}", rs.setChildDay)
		protected.With(rs.runtime.Permission(AccessRegister), withTx).Delete("/participation/{studentId}/days/{date}", rs.clearChildDay)
		protected.With(rs.runtime.Permission(AccessRegister), withTx).Put("/participation/{studentId}/schedule", rs.replaceChildSchedule)
		rs.cancellationRoutes(protected, withTx)
	})
	return router
}

type MealPlanWeekEntryResponse struct {
	Date     string  `json:"date"`
	Position int     `json:"position"`
	Dish     string  `json:"dish"`
	Note     *string `json:"note,omitempty"`
	// Allergens are the codes of the main allergens; empty when unmarked.
	Allergens []string `json:"allergens"`
}

type DailyParticipantResponse struct {
	StudentID   ident.ID `json:"student_id"`
	FirstName   string   `json:"first_name"`
	LastName    string   `json:"last_name"`
	SchoolClass string   `json:"school_class"`
}

type DailyListResponse struct {
	Date       string    `json:"date" contract:"date"`
	CutoffTime string    `json:"cutoff_time"`
	Deadline   time.Time `json:"deadline"`
	Closed     bool      `json:"closed"`
	// MealCancelled: closed because the school cancelled lunch (#7656).
	MealCancelled bool                       `json:"meal_cancelled,omitempty"`
	Participants  []DailyParticipantResponse `json:"participants"`
	Others        []DailyParticipantResponse `json:"others,omitempty"`
}
type WeeklyDayResponse struct {
	Date     string    `json:"date" contract:"date"`
	Deadline time.Time `json:"deadline"`
	Closed   bool      `json:"closed"`
	// MealCancelled: closed because the school cancelled lunch (#7656).
	MealCancelled bool                       `json:"meal_cancelled,omitempty"`
	Participants  []DailyParticipantResponse `json:"participants"`
}
type WeeklyListResponse struct {
	WeekStart string              `json:"week_start" contract:"date"`
	Days      []WeeklyDayResponse `json:"days"`
}

type DishRequest struct {
	Dish string  `json:"dish"`
	Note *string `json:"note"`
	// Allergens are codes of the main allergens; omitted means none.
	Allergens []string `json:"allergens"`
}

// MealPlanDishResponse is one dish of a day as stored.
type MealPlanDishResponse struct {
	Dish string  `json:"dish"`
	Note *string `json:"note,omitempty"`
	// Allergens are the codes of the main allergens; empty when unmarked.
	Allergens []string `json:"allergens"`
}

// MealPlanDayResponse is one weekday of the plan as stored. Version is the
// read-state token of its dishes (ADR 0311); a save of the day sends it
// back as expected_version. An empty day has one too.
type MealPlanDayResponse struct {
	Date    string                 `json:"date" contract:"date"`
	Version string                 `json:"version"`
	Dishes  []MealPlanDishResponse `json:"dishes"`
}

// SaveDayRequest replaces the dishes of a day; an empty list clears it.
// ExpectedVersion is the version of the day as its saver read it: a day
// stored differently since, and a save without one, is refused with
// general.changed_since_read.
type SaveDayRequest struct {
	Dishes          *[]DishRequest `json:"dishes"`
	ExpectedVersion string         `json:"expected_version"`
}

func (request *SaveDayRequest) Bind(*http.Request) error {
	if request.Dishes == nil {
		return errors.New("dishes is required (use an empty array to clear the day)")
	}
	return nil
}

// SetDayRequest is the body of the deprecated PUT /{date}: Expected is the
// day as the saver read it and stands for its version; without it the save
// is refused.
type SetDayRequest struct {
	Dishes   *[]DishRequest `json:"dishes"`
	Expected *[]DishRequest `json:"expected"`
}

func (request *SetDayRequest) Bind(*http.Request) error {
	if request.Dishes == nil {
		return errors.New("dishes is required (use an empty array to clear the day)")
	}
	return nil
}

func (rs *Resource) getWeek(w http.ResponseWriter, r *http.Request) {
	weekStart := r.URL.Query().Get("week_start")
	parsed, err := mealplanModule.ParseDate(weekStart)
	if err != nil {
		rs.runtime.InvalidRequest(w, r, errors.New("week_start must be in YYYY-MM-DD format"))
		return
	}
	entries, err := rs.module.Week(r.Context(), parsed)
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to load meal plan")
		return
	}
	responses := make([]MealPlanWeekEntryResponse, 0, len(entries))
	for _, entry := range entries {
		responses = append(responses, MealPlanWeekEntryResponse{
			Date: string(entry.Date), Position: entry.Position, Dish: entry.Dish, Note: entry.Note, Allergens: entry.AllergenCodes(),
		})
	}
	rs.runtime.Success(w, r, http.StatusOK, responses, "Meal plan retrieved successfully")
}

// getDays reads Monday to Friday of a week, each day with its version.
func (rs *Resource) getDays(w http.ResponseWriter, r *http.Request) {
	weekStart, err := mealplanModule.ParseDate(r.URL.Query().Get("week_start"))
	if err != nil {
		rs.runtime.InvalidRequest(w, r, errors.New("week_start must be in YYYY-MM-DD format"))
		return
	}
	days, err := rs.module.Days(r.Context(), weekStart)
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to load meal plan")
		return
	}
	responses := make([]MealPlanDayResponse, 0, len(days))
	for _, day := range days {
		responses = append(responses, dayResponse(day))
	}
	rs.runtime.Success(w, r, http.StatusOK, responses, "Meal plan retrieved successfully")
}

func dayResponse(day mealplanModule.Day) MealPlanDayResponse {
	dishes := make([]MealPlanDishResponse, 0, len(day.Dishes))
	for _, dish := range day.Dishes {
		allergens := make([]string, 0, len(dish.Allergens))
		for _, allergen := range dish.Allergens {
			allergens = append(allergens, string(allergen))
		}
		dishes = append(dishes, MealPlanDishResponse{Dish: dish.Dish, Note: dish.Note, Allergens: allergens})
	}
	return MealPlanDayResponse{Date: string(day.Date), Version: day.Version, Dishes: dishes}
}

// saveDay replaces a day against the version its saver read and answers the
// day as stored, with its new version.
func (rs *Resource) saveDay(w http.ResponseWriter, r *http.Request) {
	date, ok := rs.dayParam(w, r)
	if !ok {
		return
	}
	request := &SaveDayRequest{}
	if err := render.Bind(r, request); err != nil {
		rs.runtime.InvalidRequest(w, r, err)
		return
	}
	day, err := rs.module.ReplaceDay(r.Context(), mealplanModule.ReplaceDay{
		Date: date, Dishes: moduleDishes(*request.Dishes), ExpectedVersion: request.ExpectedVersion, AccountID: rs.runtime.CurrentAccountID(r.Context()),
	})
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to save meal")
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, dayResponse(day), "Meal plan day saved successfully")
}

func (rs *Resource) dayParam(w http.ResponseWriter, r *http.Request) (mealplanModule.Date, bool) {
	date, err := mealplanModule.ParseDate(chi.URLParam(r, "date"))
	if err != nil {
		rs.runtime.InvalidRequest(w, r, errors.New("date must be in YYYY-MM-DD format"))
		return "", false
	}
	return date, true
}

// setDay is the deprecated save with the day as read instead of its version.
func (rs *Resource) setDay(w http.ResponseWriter, r *http.Request) {
	date, ok := rs.dayParam(w, r)
	if !ok {
		return
	}
	request := &SetDayRequest{}
	if err := render.Bind(r, request); err != nil {
		rs.runtime.InvalidRequest(w, r, err)
		return
	}
	command := mealplanModule.ReplaceDay{Date: date, Dishes: moduleDishes(*request.Dishes), AccountID: rs.runtime.CurrentAccountID(r.Context())}
	if request.Expected != nil {
		expected := moduleDishes(*request.Expected)
		command.ExpectedDishes = &expected
	}
	if _, err := rs.module.ReplaceDay(r.Context(), command); err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to save meal")
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, nil, "Meal plan day saved successfully")
}

func moduleDishes(requests []DishRequest) []mealplanModule.Dish {
	dishes := make([]mealplanModule.Dish, 0, len(requests))
	for _, dish := range requests {
		allergens := make([]mealplanModule.Allergen, 0, len(dish.Allergens))
		for _, code := range dish.Allergens {
			allergens = append(allergens, mealplanModule.Allergen(code))
		}
		dishes = append(dishes, mealplanModule.Dish{Dish: dish.Dish, Note: dish.Note, Allergens: allergens})
	}
	return dishes
}

// deleteDay is the deprecated clear of a day; it clears only against the
// version given as expected_version.
func (rs *Resource) deleteDay(w http.ResponseWriter, r *http.Request) {
	date, ok := rs.dayParam(w, r)
	if !ok {
		return
	}
	command := mealplanModule.ReplaceDay{Date: date, ExpectedVersion: r.URL.Query().Get("expected_version"), AccountID: rs.runtime.CurrentAccountID(r.Context())}
	if _, err := rs.module.ReplaceDay(r.Context(), command); err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to delete meal")
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, nil, "Meal deleted successfully")
}

func (rs *Resource) getParticipants(w http.ResponseWriter, r *http.Request) {
	list, ok := rs.dailyList(w, r)
	if !ok {
		return
	}
	response := DailyListResponse{Date: string(list.Date), CutoffTime: list.CutoffTime, Deadline: list.Deadline, Closed: list.Closed, MealCancelled: list.MealCancelled, Participants: participantResponses(list.Participants)}
	// The children who do not eat are there to register them, so only a
	// caller who may change a registration sees them.
	if r.URL.Query().Get("include") == "all" && rs.runtime.Allowed(r.Context(), AccessRegister) {
		response.Others = participantResponses(list.Others)
	}
	rs.runtime.Success(w, r, http.StatusOK, response, "Meal participation list retrieved successfully")
}

func (rs *Resource) getWeeklyParticipants(w http.ResponseWriter, r *http.Request) {
	week, ok := rs.weeklyList(w, r)
	if !ok {
		return
	}
	days := make([]WeeklyDayResponse, 0, len(week.Days))
	for _, day := range week.Days {
		days = append(days, WeeklyDayResponse{Date: string(day.Date), Deadline: day.Deadline, Closed: day.Closed, MealCancelled: day.MealCancelled, Participants: participantResponses(day.Participants)})
	}
	rs.runtime.Success(w, r, http.StatusOK, WeeklyListResponse{WeekStart: string(week.WeekStart), Days: days}, "Weekly meal participation list retrieved successfully")
}

func participantResponses(participants []mealplanModule.DailyParticipant) []DailyParticipantResponse {
	responses := make([]DailyParticipantResponse, 0, len(participants))
	for _, participant := range participants {
		responses = append(responses, DailyParticipantResponse{StudentID: ident.ID(participant.StudentID), FirstName: participant.FirstName, LastName: participant.LastName, SchoolClass: participant.SchoolClass})
	}
	return responses
}

func (rs *Resource) exportParticipants(w http.ResponseWriter, r *http.Request) {
	list, ok := rs.dailyList(w, r)
	if !ok {
		return
	}
	format, ok := rs.exportFormat(w, r)
	if !ok {
		return
	}
	export, err := list.Export()
	if err != nil {
		rs.writeExport(w, r, ExportFile{}, err)
		return
	}
	file, err := rs.runtime.RenderList(export, format)
	rs.writeExport(w, r, file, err)
}

func (rs *Resource) exportWeeklyParticipants(w http.ResponseWriter, r *http.Request) {
	week, ok := rs.weeklyList(w, r)
	if !ok {
		return
	}
	format, ok := rs.exportFormat(w, r)
	if !ok {
		return
	}
	export, err := week.Export()
	if err != nil {
		rs.writeExport(w, r, ExportFile{}, err)
		return
	}
	file, err := rs.runtime.RenderList(export, format)
	rs.writeExport(w, r, file, err)
}

func (rs *Resource) exportFormat(w http.ResponseWriter, r *http.Request) (string, bool) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "pdf"
	}
	if format != "pdf" && format != "xlsx" {
		rs.runtime.InvalidRequest(w, r, fmt.Errorf("unsupported format %q", format))
		return "", false
	}
	return format, true
}

func (rs *Resource) writeExport(w http.ResponseWriter, r *http.Request, file ExportFile, err error) {
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to export meal participation list")
		return
	}
	writeFile(w, file)
}

func (rs *Resource) weeklyList(w http.ResponseWriter, r *http.Request) (mealplanModule.WeeklyList, bool) {
	weekStart, err := mealplanModule.ParseDate(r.URL.Query().Get("week_start"))
	if err != nil {
		rs.runtime.InvalidRequest(w, r, errors.New("week_start must be in YYYY-MM-DD format"))
		return mealplanModule.WeeklyList{}, false
	}
	week, err := rs.module.WeeklyList(r.Context(), weekStart)
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to load meal participation list")
		return mealplanModule.WeeklyList{}, false
	}
	return week, true
}

func (rs *Resource) dailyList(w http.ResponseWriter, r *http.Request) (mealplanModule.DailyList, bool) {
	date, err := mealplanModule.ParseDate(r.URL.Query().Get("date"))
	if err != nil {
		rs.runtime.InvalidRequest(w, r, errors.New("date must be in YYYY-MM-DD format"))
		return mealplanModule.DailyList{}, false
	}
	list, err := rs.module.DailyList(r.Context(), date)
	if err != nil {
		rs.runtime.ModuleFailure(w, r, err, "failed to load meal participation list")
		return mealplanModule.DailyList{}, false
	}
	return list, true
}
