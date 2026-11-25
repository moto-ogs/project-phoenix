package common

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/render"
)

// Response is the standard API response structure
type Response struct {
	Status  string      `json:"status"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
}

// NewResponse creates a new successful response
func NewResponse(data interface{}, message string) *Response {
	return &Response{
		Status:  "success",
		Data:    data,
		Message: message,
	}
}

// Render implements the render.Renderer interface for Response
func (r *Response) Render(_ http.ResponseWriter, _ *http.Request) error {
	return nil
}

// answerObserver sees every success answer before it is written and may
// refuse it. Production installs none; the test build holds the answers
// against the contract (answer_contract_test_helpers.go).
var answerObserver func(r *http.Request, status int, data any, envelope any) error

// refusalObserver sees every refusal (a 4xx) before it is written. Production
// installs none; the test build counts it as the answer of a route that only
// refuses (RouteContract.Refuses).
var refusalObserver func(r *http.Request)

// answerObserved reports whether the answer may be written. A refused answer
// has been replaced by a 500 that names the reason.
func answerObserved(w http.ResponseWriter, r *http.Request, status int, data any, envelope any) bool {
	if answerObserver == nil {
		return true
	}
	if err := answerObserver(r, status, data, envelope); err != nil {
		RenderError(w, r, ErrorInternalServer(err))
		return false
	}
	return true
}

// Respond sends a structured response. Statuses that forbid a body (204, 205,
// 304) are sent without the envelope.
func Respond(w http.ResponseWriter, r *http.Request, status int, data interface{}, message string) {
	if !statusAllowsBody(status) {
		if answerObserved(w, r, status, nil, nil) {
			w.WriteHeader(status)
		}
		return
	}
	response := NewResponse(data, message)
	if !answerObserved(w, r, status, data, response) {
		return
	}
	render.Status(r, status)
	if err := render.Render(w, r, response); err != nil {
		slog.Default().ErrorContext(r.Context(), "failed to render response", slog.String("error", err.Error()))
		RenderError(w, r, ErrorInternalServerWrap("error rendering response", err))
	}
}

// RespondWithError answers in the shared error envelope with the class code
// of status; a handler that can name its failure renders an ErrResponse with
// a registered code instead. RenderError logs and reports a 5xx.
func RespondWithError(w http.ResponseWriter, r *http.Request, status int, errorMsg string) {
	RenderError(w, r, newErrResponse(status, errors.New(errorMsg)))
}

// statusAllowsBody reports whether a response status permits a body. HTTP 1xx,
// 204, 205 and 304 responses carry no body.
func statusAllowsBody(status int) bool {
	switch {
	case status >= 100 && status <= 199:
		return false
	case status == http.StatusNoContent, status == http.StatusResetContent, status == http.StatusNotModified:
		return false
	}
	return true
}

func isInterimStatus(status int) bool {
	return status >= http.StatusContinue && status < http.StatusOK && status != http.StatusSwitchingProtocols
}

// RespondNoContent sends a 204 No Content response
func RespondNoContent(w http.ResponseWriter, r *http.Request) {
	if !answerObserved(w, r, http.StatusNoContent, nil, nil) {
		return
	}
	render.NoContent(w, r)
}

// RespondWithJSON sends a JSON response with the given status code
func RespondWithJSON(w http.ResponseWriter, r *http.Request, status int, data interface{}) {
	render.Status(r, status)
	RenderJSON(w, r, data)
}

// Pagination represents pagination metadata for responses
type Pagination struct {
	CurrentPage  int    `json:"current_page"`
	PageSize     int    `json:"page_size"`
	TotalPages   int    `json:"total_pages"`
	TotalRecords int    `json:"total_records"`
	NextCursor   string `json:"next_cursor,omitempty"`
}

// PaginationParams groups parameters for paginated responses to reduce function parameter count
type PaginationParams struct {
	Page       int
	PageSize   int
	Total      int
	NextCursor string
}

// PaginatedResponse is a response with pagination metadata
type PaginatedResponse struct {
	Status     string      `json:"status"`
	Data       interface{} `json:"data,omitempty"`
	Pagination *Pagination `json:"pagination,omitempty"`
	Message    string      `json:"message,omitempty"`
}

// NewPaginatedResponse creates a new paginated response
func NewPaginatedResponse(data interface{}, page, pageSize, total int, message string) *PaginatedResponse {
	var totalPages int
	if pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize // Ceiling division
	}

	return &PaginatedResponse{
		Status: "success",
		Data:   data,
		Pagination: &Pagination{
			CurrentPage:  page,
			PageSize:     pageSize,
			TotalPages:   totalPages,
			TotalRecords: total,
		},
		Message: message,
	}
}

// Render implements the render.Renderer interface for PaginatedResponse
func (p *PaginatedResponse) Render(_ http.ResponseWriter, _ *http.Request) error {
	return nil
}

// RespondPaginated sends a paginated response using PaginationParams struct
func RespondPaginated(w http.ResponseWriter, r *http.Request, status int, data interface{}, params PaginationParams, message string) {
	response := NewPaginatedResponse(data, params.Page, params.PageSize, params.Total, message)
	response.Pagination.NextCursor = params.NextCursor
	if !answerObserved(w, r, status, data, response) {
		return
	}
	render.Status(r, status)
	if err := render.Render(w, r, response); err != nil {
		slog.Default().ErrorContext(r.Context(), "failed to render paginated response", slog.String("error", err.Error()))
		RenderError(w, r, ErrorInternalServerWrap("error rendering paginated response", err))
	}
}
