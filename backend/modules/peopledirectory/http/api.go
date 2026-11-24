// Package users exposes the staff People Directory HTTP adapter under
// /api/users. It talks to the public capability only; rendering, auth,
// pagination and the foreign lookups it needs are injected by the root.
package users

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type Middleware = func(http.Handler) http.Handler

// FailureKind selects the response shape the root renders for an error; the
// wire format stays with the shared renderer so it matches every other
// staff endpoint.
type FailureKind string

const (
	FailureInvalidRequest FailureKind = "invalid_request"
	FailureNotFound       FailureKind = "not_found"
	FailureConflict       FailureKind = "conflict"
	FailureInternal       FailureKind = "internal"
	FailureUnauthorized   FailureKind = "unauthorized"
	FailureForbidden      FailureKind = "forbidden"
)

type Pagination struct {
	Page     int
	PageSize int
	Total    int
}

// Runtime carries everything the adapter must not own: the protected route
// group, permission middleware, response rendering, and the two foreign
// lookups (accounts, RFID cards) the person form validates against.
type Runtime struct {
	Protected        func(chi.Router, func(chi.Router, Middleware))
	Permission       func(string) Middleware
	ParsePagination  func(*http.Request) (page, pageSize int)
	Success          func(http.ResponseWriter, *http.Request, int, any, string)
	SuccessPaginated func(http.ResponseWriter, *http.Request, int, any, Pagination, string)
	Failure          func(http.ResponseWriter, *http.Request, FailureKind, error)
	// AccountEmails returns e-mails keyed by account ID. Missing accounts are
	// absent from the result.
	AccountEmails func(context.Context, []int64) (map[int64]string, error)
	// TagExists reports whether an RFID card with that identifier exists.
	TagExists       func(context.Context, string) (bool, error)
	ObserveResponse func(int, string)
	// ParseIDParam reads an int64 path parameter: api/common.ParseIDParam.
	ParseIDParam func(*http.Request, string) (int64, error)
}

type Resource struct {
	directory peopledirectory.Capability
	runtime   Runtime
}

func NewResource(directory peopledirectory.Capability, runtime Runtime) *Resource {
	if directory == nil || runtime.Protected == nil || runtime.Permission == nil || runtime.ParsePagination == nil ||
		runtime.Success == nil || runtime.SuccessPaginated == nil || runtime.Failure == nil ||
		runtime.AccountEmails == nil || runtime.TagExists == nil || runtime.ObserveResponse == nil ||
		runtime.ParseIDParam == nil {
		panic("users HTTP: all dependencies are required")
	}
	return &Resource{directory: directory, runtime: runtime}
}

func (rs *Resource) Router() chi.Router {
	router := chi.NewRouter()
	router.Use(render.SetContentType(render.ContentTypeJSON))
	rs.runtime.Protected(router, func(protected chi.Router, withTx Middleware) {
		protected.With(rs.runtime.Permission(permissions.UsersRead), withTx).Get("/{id}", rs.getPerson)
		protected.With(rs.runtime.Permission(permissions.UsersUpdate), withTx).Put("/{id}", rs.updatePerson)
	})
	return router
}

// PersonResponse is the wire shape of one directory entry.
type PersonResponse struct {
	ID        ident.ID  `json:"id"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Email     string    `json:"email,omitempty"`
	TagID     string    `json:"tag_id,omitempty" contract_text:"RFID tag code, not a database row ID"`
	AccountID ident.ID  `json:"account_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Version is the token of the stored person (ADR 0311); an update sends
	// it back as expected_version.
	Version string `json:"version"`
}

// DirectoryPersonRequest is the create and update payload.
type DirectoryPersonRequest struct {
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
	TagID     string   `json:"tag_id,omitempty" contract_text:"RFID tag code, not a database row ID"`
	AccountID ident.ID `json:"account_id,omitempty"`
	// ExpectedVersion is the version of the person the form showed (ADR
	// 0311): the person GET's, or person_version of a staff record. An
	// update refuses another one, also an empty one.
	ExpectedVersion string `json:"expected_version,omitempty"`
}

// Bind reports every blank name as its own field (#2511); the shared error
// envelope lists them in `errors`. The text is diagnostics (#2520).
func (request *DirectoryPersonRequest) Bind(*http.Request) error {
	missing := validation.Errors{}
	if request.FirstName == "" {
		missing["first_name"] = errors.New("is required")
	}
	if request.LastName == "" {
		missing["last_name"] = errors.New("is required")
	}
	if len(missing) == 0 {
		return nil
	}
	return missing
}

func (rs *Resource) getPerson(w http.ResponseWriter, r *http.Request) {
	id, ok := rs.parseID(w, r)
	if !ok {
		return
	}
	person, err := rs.directory.FindPerson(r.Context(), id)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	rs.respondPerson(w, r, http.StatusOK, person, "Person retrieved successfully")
}

func (rs *Resource) updatePerson(w http.ResponseWriter, r *http.Request) {
	id, ok := rs.parseID(w, r)
	if !ok {
		return
	}
	existing, err := rs.directory.FindPerson(r.Context(), id)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	request := &DirectoryPersonRequest{}
	if err := render.Bind(r, request); err != nil {
		rs.failure(w, r, FailureInvalidRequest, err, "invalid_request")
		return
	}
	// An empty tag or account keeps the stored link; only a supplied value
	// re-points it (the previous handler merged the same way).
	input := peopledirectory.UpdatePerson{
		ID: id, FirstName: request.FirstName, LastName: request.LastName,
		Birthday: existing.Birthday, TagID: existing.TagID, AccountID: existing.AccountID,
		ExpectedVersion: &request.ExpectedVersion,
	}
	var changedTag *string
	var changedAccount *int64
	if request.TagID != "" && (existing.TagID == nil || *existing.TagID != peopledirectory.NormalizeTagID(request.TagID)) {
		input.TagID = &request.TagID
		changedTag = &request.TagID
	}
	if request.AccountID != 0 && (existing.AccountID == nil || ident.ID(*existing.AccountID) != request.AccountID) {
		input.AccountID = (*int64)(&request.AccountID)
		changedAccount = (*int64)(&request.AccountID)
	}
	if !rs.referencesExist(w, r, changedTag, changedAccount) {
		return
	}
	person, err := rs.directory.UpdatePerson(r.Context(), input)
	if err != nil {
		rs.moduleFailure(w, r, err)
		return
	}
	rs.respondPerson(w, r, http.StatusOK, person, "Person updated successfully")
}

// referencesExist validates the foreign links a person form may carry. The
// directory owns persons only, so accounts and RFID cards are checked
// through the root-injected lookups before the write.
func (rs *Resource) referencesExist(w http.ResponseWriter, r *http.Request, tagID *string, accountID *int64) bool {
	if accountID != nil {
		emails, err := rs.runtime.AccountEmails(r.Context(), []int64{*accountID})
		if err != nil {
			rs.failure(w, r, FailureInternal, err, "internal_error")
			return false
		}
		if _, found := emails[*accountID]; !found {
			rs.failure(w, r, FailureNotFound, errors.New("account not found"), "account_not_found")
			return false
		}
	}
	if tagID != nil {
		found, err := rs.runtime.TagExists(r.Context(), peopledirectory.NormalizeTagID(*tagID))
		if err != nil {
			rs.failure(w, r, FailureInternal, err, "internal_error")
			return false
		}
		if !found {
			rs.failure(w, r, FailureNotFound, errors.New("RFID card not found"), "rfid_card_not_found")
			return false
		}
	}
	return true
}

func (rs *Resource) respondPerson(w http.ResponseWriter, r *http.Request, status int, person peopledirectory.Person, message string) {
	response, err := rs.personResponse(r.Context(), person)
	if err != nil {
		rs.failure(w, r, FailureInternal, err, "internal_error")
		return
	}
	rs.runtime.Success(w, r, status, response, message)
	rs.runtime.ObserveResponse(status, "none")
}

func (rs *Resource) personResponses(ctx context.Context, persons []peopledirectory.Person) ([]PersonResponse, error) {
	accountIDs := make([]int64, 0, len(persons))
	seenAccounts := make(map[int64]struct{}, len(persons))
	for _, person := range persons {
		if person.AccountID == nil {
			continue
		}
		if _, seen := seenAccounts[*person.AccountID]; !seen {
			seenAccounts[*person.AccountID] = struct{}{}
			accountIDs = append(accountIDs, *person.AccountID)
		}
	}
	emails := make(map[int64]string, len(accountIDs))
	if len(accountIDs) > 0 {
		var err error
		emails, err = rs.runtime.AccountEmails(ctx, accountIDs)
		if err != nil {
			return nil, err
		}
	}
	responses := make([]PersonResponse, 0, len(persons))
	for _, person := range persons {
		email := ""
		if person.AccountID != nil {
			email = emails[*person.AccountID]
		}
		responses = append(responses, newPersonResponse(person, email))
	}
	return responses, nil
}

func (rs *Resource) personResponse(ctx context.Context, person peopledirectory.Person) (PersonResponse, error) {
	responses, err := rs.personResponses(ctx, []peopledirectory.Person{person})
	if err != nil {
		return PersonResponse{}, err
	}
	return responses[0], nil
}

func (rs *Resource) parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := rs.runtime.ParseIDParam(r, "id")
	if err != nil || id <= 0 {
		rs.failure(w, r, FailureInvalidRequest, errors.New("invalid person ID"), "invalid_parameters")
		return 0, false
	}
	return id, true
}

func (rs *Resource) moduleFailure(w http.ResponseWriter, r *http.Request, err error) {
	rs.failure(w, r, classifyModuleError(err), err, peopledirectory.ErrorCode(err))
}

func (rs *Resource) failure(w http.ResponseWriter, r *http.Request, kind FailureKind, err error, code string) {
	kind = renderedKind(kind, err)
	rs.runtime.Failure(w, r, kind, err)
	rs.runtime.ObserveResponse(statusOf(kind), code)
}

// businessRejection is the shape of a module's business rejection (ADR
// 0006): a stable code and the values its message names. An input
// rejection carries a field instead of details and keeps its 400.
type businessRejection interface {
	error
	ErrorCode() string
	ErrorDetails() any
}

// renderedKind is the kind the root answers with. A business rejection a
// handler did not classify, readstate.ErrChanged among them (ADR 0311), is
// a 409 and never a server error, so the response metric records the
// status the client sees and no handler needs a case per rejection.
func renderedKind(kind FailureKind, err error) FailureKind {
	var rejection businessRejection
	if kind == FailureInternal && errors.As(err, &rejection) {
		return FailureConflict
	}
	return kind
}

func classifyModuleError(err error) FailureKind {
	switch {
	case errors.Is(err, peopledirectory.ErrPersonNotFound):
		return FailureNotFound
	case errors.Is(err, peopledirectory.ErrInvalidPerson):
		return FailureInvalidRequest
	case errors.Is(err, peopledirectory.ErrTagConflict), errors.Is(err, peopledirectory.ErrAccountConflict):
		return FailureConflict
	default:
		return FailureInternal
	}
}

func statusOf(kind FailureKind) int {
	switch kind {
	case FailureInvalidRequest:
		return http.StatusBadRequest
	case FailureNotFound:
		return http.StatusNotFound
	case FailureConflict:
		return http.StatusConflict
	case FailureUnauthorized:
		return http.StatusUnauthorized
	case FailureForbidden:
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}

func newPersonResponse(person peopledirectory.Person, email string) PersonResponse {
	response := PersonResponse{
		ID: ident.ID(person.ID), FirstName: person.FirstName, LastName: person.LastName,
		Email: email, CreatedAt: person.CreatedAt, UpdatedAt: person.UpdatedAt,
		Version: peopledirectory.PersonVersion(person.UpdatedAt),
	}
	if person.TagID != nil {
		response.TagID = *person.TagID
	}
	if person.AccountID != nil {
		response.AccountID = ident.ID(*person.AccountID)
	}
	return response
}
