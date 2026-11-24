package parent

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

type requestSharingBody struct {
	RecipientGuardianProfileIDs []string `json:"recipient_guardian_profile_ids"`
	// ExpectedVersion is the version of the sharing the guardian read. The
	// choice replaces the whole recipient set, so a missing or outdated one is
	// refused with 409 general.changed_since_read (ADR 0311).
	ExpectedVersion string `json:"expected_version"`
}

type requestSharingRecipientResponse struct {
	GuardianProfileID string `json:"guardian_profile_id"`
	FirstName         string `json:"first_name"`
	LastName          string `json:"last_name"`
	Selected          bool   `json:"selected"`
}

type requestSharingResponse struct {
	FamilyProtected bool                              `json:"family_protected"`
	Recipients      []requestSharingRecipientResponse `json:"recipients"`
}

// requestSharingStateResponse is the sharing of one request. Version is what
// a change of it sends back as expected_version.
type requestSharingStateResponse struct {
	FamilyProtected bool                              `json:"family_protected"`
	Recipients      []requestSharingRecipientResponse `json:"recipients"`
	Version         string                            `json:"version"`
}

func (rs *Resource) getRequestSharingOptions(w http.ResponseWriter, r *http.Request) {
	if rs.RequestSharing == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("request sharing service is not configured")))
		return
	}
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, ok := parsePathStudentID(w, r)
	if !ok {
		return
	}
	state, err := rs.RequestSharing.GetRequestSharingOptions(r.Context(), accountID, studentID)
	if err != nil {
		renderRequestSharingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toRequestSharingResponse(state), "Request sharing options retrieved")
}

func (rs *Resource) getRequestSharing(w http.ResponseWriter, r *http.Request) {
	accountID, studentID, requestType, requestID, ok := rs.requestSharingParams(w, r)
	if !ok {
		return
	}
	state, err := rs.RequestSharing.GetRequestSharing(r.Context(), accountID, studentID, requestType, requestID)
	if err != nil {
		renderRequestSharingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toRequestSharingStateResponse(state), "Request sharing retrieved")
}

func (rs *Resource) setRequestSharing(w http.ResponseWriter, r *http.Request) {
	accountID, studentID, requestType, requestID, ok := rs.requestSharingParams(w, r)
	if !ok {
		return
	}
	var body requestSharingBody
	if err := wire.Decode(r.Body, &body); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeCareRequestSharingInvalid))
		return
	}
	recipients, err := parseRecipientGuardianProfileIDs(body.RecipientGuardianProfileIDs)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeCareRequestSharingInvalid))
		return
	}
	state, err := rs.RequestSharing.SetRequestSharing(r.Context(), accountID, studentID, requestType, requestID, recipients, body.ExpectedVersion)
	if err != nil {
		renderRequestSharingError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toRequestSharingStateResponse(state), "Request sharing updated")
}

func (rs *Resource) requestSharingParams(
	w http.ResponseWriter, r *http.Request,
) (accountID, studentID int64, requestType string, requestID int64, ok bool) {
	if rs.RequestSharing == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("request sharing service is not configured")))
		return 0, 0, "", 0, false
	}
	accountID, ok = rs.parentAccountID(w, r)
	if !ok {
		return 0, 0, "", 0, false
	}
	studentID, ok = parsePathStudentID(w, r)
	if !ok {
		return 0, 0, "", 0, false
	}
	requestType = strings.TrimSpace(chi.URLParam(r, "requestType"))
	requestID, ok = common.ParsePositiveInt64IDWithError(w, r, "requestId", "invalid request id")
	return accountID, studentID, requestType, requestID, ok
}

func parseRecipientGuardianProfileIDs(raw []string) ([]int64, error) {
	ids := make([]int64, 0, len(raw))
	seen := make(map[int64]struct{}, len(raw))
	for _, value := range raw {
		id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil || id <= 0 {
			return nil, parentService.ErrRequestSharingInvalid
		}
		if _, exists := seen[id]; exists {
			return nil, parentService.ErrRequestSharingInvalid
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

func toRequestSharingResponse(state *parentService.RequestSharingState) requestSharingResponse {
	response := requestSharingResponse{FamilyProtected: state.FamilyProtected, Recipients: make([]requestSharingRecipientResponse, 0, len(state.Recipients))}
	for _, recipient := range state.Recipients {
		response.Recipients = append(response.Recipients, requestSharingRecipientResponse{
			GuardianProfileID: strconv.FormatInt(recipient.GuardianProfileID, 10),
			FirstName:         recipient.FirstName, LastName: recipient.LastName, Selected: recipient.Selected,
		})
	}
	return response
}

func toRequestSharingStateResponse(state *parentService.RequestSharingState) requestSharingStateResponse {
	shared := toRequestSharingResponse(state)
	return requestSharingStateResponse{FamilyProtected: shared.FamilyProtected, Recipients: shared.Recipients, Version: state.Version}
}

var requestSharingErrorRenderer = common.RulesRenderer([]common.ErrorRule{
	{Target: parentService.ErrRequestSharingInvalid, Render: func(err error) render.Renderer {
		return common.ErrorInvalidRequestWithCode(err, common.CodeCareRequestSharingInvalid)
	}},
	{Target: parentService.ErrRequestSharingForbidden, Render: func(err error) render.Renderer {
		return common.ErrorForbiddenWithCode(err, common.CodeCareFamilyProtection)
	}},
	{Target: parentService.ErrRequestSharingNotFound, Render: func(err error) render.Renderer {
		return common.ErrorNotFoundWithCode(err, common.CodeCareRequestNotFound)
	}},
	{Target: parentService.ErrChildNotLinked, Render: func(err error) render.Renderer {
		return common.ErrorNotFoundWithCode(err, common.CodeCareRequestNotFound)
	}},
	{Target: parentService.ErrGuardianPermissionDenied, Render: func(err error) render.Renderer {
		return common.ErrorForbiddenWithCode(err, common.CodeCareGuardianPermissionDenied)
	}},
}, common.ErrorInternalServer)

func renderRequestSharingError(w http.ResponseWriter, r *http.Request, err error) {
	common.RenderError(w, r, requestSharingErrorRenderer(err))
}
