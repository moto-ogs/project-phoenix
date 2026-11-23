// Package feedback exposes the staff Feedback HTTP adapter.
package feedback

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	feedbackModule "github.com/moto-ogs/project-phoenix/modules/feedback"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type Middleware = func(http.Handler) http.Handler

// ErrFeatureDisabled refuses the feedback of a school that has switched it
// off; the root answers it with its registered code.
var ErrFeatureDisabled = feedbackModule.ErrFeatureDisabled

// Failure is a refused request: its HTTP status and the error whose text the
// shared error envelope carries.
type Failure struct {
	Status int
	Err    error
}

type Runtime struct {
	Protected       func(chi.Router, func(chi.Router, Middleware))
	Permission      func(string) Middleware
	Success         func(http.ResponseWriter, *http.Request, int, any, string)
	Failure         func(http.ResponseWriter, *http.Request, Failure)
	ObserveResponse func(int, string)
	// ParseIDParam reads an int64 path parameter: api/common.ParseIDParam.
	ParseIDParam func(*http.Request, string) (int64, error)
}

type Resource struct {
	module  feedbackModule.Capability
	runtime Runtime
}

func NewResource(module feedbackModule.Capability, runtime Runtime) *Resource {
	if module == nil || runtime.Protected == nil || runtime.Permission == nil || runtime.Success == nil || runtime.Failure == nil || runtime.ObserveResponse == nil ||
		runtime.ParseIDParam == nil {
		panic("feedback HTTP: all dependencies are required")
	}
	return &Resource{module: module, runtime: runtime}
}

func (rs *Resource) Router() chi.Router {
	router := chi.NewRouter()
	router.Use(render.SetContentType(render.ContentTypeJSON))
	rs.runtime.Protected(router, func(protected chi.Router, withTx Middleware) {
		protected.With(rs.runtime.Permission(permissions.FeedbackRead), withTx).Get("/student/{id}", rs.getStudentFeedback)
	})
	return router
}

type FeedbackResponse struct {
	ID              ident.ID                 `json:"id"`
	Value           string                   `json:"value"`
	Day             string                   `json:"day"`
	Time            string                   `json:"time"`
	StudentID       ident.ID                 `json:"student_id"`
	IsMensaFeedback bool                     `json:"is_mensa_feedback"`
	CreatedAt       time.Time                `json:"created_at"`
	UpdatedAt       time.Time                `json:"updated_at"`
	Student         *FeedbackStudentResponse `json:"student,omitempty"`
}

type FeedbackStudentResponse struct {
	ID        ident.ID `json:"id"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
}

type FeedbackRequest struct {
	Value           string   `json:"value"`
	Day             string   `json:"day"`
	Time            string   `json:"time"`
	StudentID       ident.ID `json:"student_id"`
	IsMensaFeedback bool     `json:"is_mensa_feedback"`
}

func (request *FeedbackRequest) Bind(*http.Request) error {
	if request.Value == "" {
		return errors.New("feedback value is required")
	}
	if request.StudentID <= 0 {
		return errors.New("student ID is required")
	}
	if request.Day == "" {
		return errors.New("day is required")
	}
	if request.Time == "" {
		return errors.New("time is required")
	}
	if _, err := feedbackModule.ParseDate(request.Day); err != nil {
		return errors.New("day must be in YYYY-MM-DD format")
	}
	if _, err := time.Parse("15:04:05", request.Time); err != nil {
		return errors.New("time must be in HH:MM:SS format")
	}
	return nil
}

type BatchFeedbackRequest struct {
	Entries []FeedbackRequest `json:"entries"`
}

func (request *BatchFeedbackRequest) Bind(r *http.Request) error {
	if len(request.Entries) == 0 {
		return errors.New("at least one feedback entry is required")
	}
	for index := range request.Entries {
		if err := request.Entries[index].Bind(r); err != nil {
			return errors.New("invalid entry at index " + strconv.Itoa(index) + ": " + err.Error())
		}
	}
	return nil
}

func (rs *Resource) getStudentFeedback(w http.ResponseWriter, r *http.Request) {
	studentID, err := rs.parseID(r)
	if err != nil {
		rs.invalid(w, r, errors.New("invalid student ID"))
		return
	}
	entries, err := rs.module.FindEntries(r.Context(), feedbackModule.Filter{StudentID: &studentID})
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	rs.successEntries(w, r, entries, "Student feedback entries retrieved successfully")
}

func (request FeedbackRequest) toInput() feedbackModule.CreateEntry {
	return feedbackModule.CreateEntry{
		Value: request.Value, Day: feedbackModule.Date(request.Day), Time: request.Time,
		StudentID: request.StudentID.Int64(), IsMensaFeedback: request.IsMensaFeedback,
	}
}

func (rs *Resource) parseID(r *http.Request) (int64, error) {
	id, err := rs.runtime.ParseIDParam(r, "id")
	if err != nil || id <= 0 {
		return 0, errors.New("invalid ID")
	}
	return id, nil
}

func newFeedbackResponse(entry feedbackModule.Entry) FeedbackResponse {
	response := FeedbackResponse{
		ID: ident.ID(entry.ID), Value: entry.Value, Day: string(entry.Day), Time: entry.Time, StudentID: ident.ID(entry.StudentID),
		IsMensaFeedback: entry.IsMensaFeedback, CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt,
	}
	if entry.Student != nil {
		response.Student = &FeedbackStudentResponse{ID: ident.ID(entry.Student.ID), FirstName: entry.Student.FirstName, LastName: entry.Student.LastName}
	}
	return response
}

func (rs *Resource) successEntries(w http.ResponseWriter, r *http.Request, entries []feedbackModule.Entry, message string) {
	responses := make([]FeedbackResponse, 0, len(entries))
	for _, entry := range entries {
		responses = append(responses, newFeedbackResponse(entry))
	}
	rs.success(w, r, http.StatusOK, responses, message)
}

func (rs *Resource) invalid(w http.ResponseWriter, r *http.Request, err error) {
	rs.failure(w, r, Failure{Status: http.StatusBadRequest, Err: err}, "invalid_parameters")
}

func (rs *Resource) moduleFailure(w http.ResponseWriter, r *http.Request, err error) {
	rs.failure(w, r, Failure{Status: moduleErrorStatus(err), Err: err}, feedbackModule.ErrorCode(err))
}

func (rs *Resource) success(w http.ResponseWriter, r *http.Request, status int, data any, message string) {
	rs.successWithCode(w, r, status, data, message, "none")
}

func (rs *Resource) successWithCode(w http.ResponseWriter, r *http.Request, status int, data any, message, code string) {
	rs.runtime.Success(w, r, status, data, message)
	rs.runtime.ObserveResponse(status, code)
}

func (rs *Resource) failure(w http.ResponseWriter, r *http.Request, failure Failure, code string) {
	rs.runtime.Failure(w, r, failure)
	rs.runtime.ObserveResponse(failure.Status, code)
}

func moduleErrorStatus(err error) int {
	switch {
	case errors.Is(err, feedbackModule.ErrFeatureDisabled):
		return http.StatusForbidden
	case errors.Is(err, feedbackModule.ErrEntryNotFound), errors.Is(err, feedbackModule.ErrStudentNotFound):
		return http.StatusNotFound
	case errors.Is(err, feedbackModule.ErrInvalidEntryData), errors.Is(err, feedbackModule.ErrInvalidDateRange):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}
