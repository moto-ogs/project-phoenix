package parent

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// CareScheduleResponse is the parent-facing weekly care plan: per weekday the
// current arrival/pickup wall-clock times (HH:MM, empty = not set) and the
// allowed departure-mode keys, plus the child's pending change request (nil
// when none) and whether the calling guardian may request a change.
type CareScheduleResponse struct {
	Weekdays            []CareScheduleWeekdayResponse           `json:"weekdays"`
	PendingRequest      *PendingCareRequestResponse             `json:"pending_request,omitempty"`
	CanRequest          bool                                    `json:"can_request"`
	RequestCapabilities CareScheduleRequestCapabilitiesResponse `json:"request_capabilities"`
	// TodayAbsent is true when the child has any active scheduled absence today
	// (sick / excused / class trip, any source). Parent-safe boolean only — the
	// "Heute → Abholung" tile uses it so it never shows a pickup time for a child
	// the school has recorded as off today. Only populated by the GET read view.
	TodayAbsent bool `json:"today_absent"`
	// TodayDate is the Berlin calendar day (YYYY-MM-DD) TodayAbsent was resolved
	// against — the server's "today" at request time. The client binds its
	// cached absence signal to this date instead of the browser's request-start
	// day so a response crossing Berlin midnight can't stamp the new day's
	// today_absent onto yesterday's pickup tile (#1725 review). Empty on the
	// write views (POST/PUT), which do not populate TodayAbsent.
	TodayDate string `json:"today_date,omitempty"`
}

type CareScheduleRequestCapabilitiesResponse struct {
	Arrival       bool `json:"arrival"`
	Pickup        bool `json:"pickup"`
	DepartureMode bool `json:"departure_mode"`
}

// CareScheduleWeekdayResponse is one weekday (1=Mon..5=Fri) of the plan.
type CareScheduleWeekdayResponse struct {
	Weekday int      `json:"weekday"`
	Status  string   `json:"status"`
	Arrival string   `json:"arrival,omitempty"`
	Pickup  string   `json:"pickup,omitempty"`
	Modes   []string `json:"modes"`
}

// PendingCareRequestResponse is the child's open change request on the read
// view, with the same "current → requested" diff staff see.
type PendingCareRequestResponse struct {
	ID              ident.ID                        `json:"id"`
	CreatedAt       string                          `json:"created_at"`
	Diff            []ParentCareRequestDiffResponse `json:"diff"`
	SubmittedBySelf bool                            `json:"submitted_by_self"`
	// Version is what an edit of this request sends back as
	// expected_version (ADR 0311).
	Version string `json:"version"`
}

// ParentCareRequestDiffResponse mirrors the messaging diff wire shape so the
// frontend's RequestDiffPanel renders it unchanged.
type ParentCareRequestDiffResponse struct {
	Label    string   `json:"label"`
	Old      string   `json:"old"`
	New      string   `json:"new"`
	Weekday  int      `json:"weekday,omitempty"`
	CareKind string   `json:"care_kind,omitempty"`
	OldModes []string `json:"old_modes,omitempty"`
	NewMode  string   `json:"new_mode,omitempty"`
}

// CareScheduleRequestBody is the wire shape for POST .../care-schedule/requests.
type CareScheduleRequestBody struct {
	Payload common.DeferredJSON[*carerequests.WeeklyChange] `json:"payload" contract_refines:"The care-plan parser already validates this weekly change document"`
	// Signature is needed when a weekday lets the child walk home alone
	// (#4780).
	Signature *declarationSignatureRequest `json:"signature,omitempty"`
}

// Pass the typed weekly document to the existing workflow boundary. If a
// nested value fails to decode, let the workflow return its established
// request error. A non-object still fails HTTP body decoding as before.
func weeklyPayload(w http.ResponseWriter, r *http.Request, input common.DeferredJSON[*carerequests.WeeklyChange]) (map[string]any, bool) {
	raw := input.Invalid
	if raw == nil {
		var err error
		raw, err = json.Marshal(input.Value)
		if err != nil {
			common.RenderError(w, r, common.ErrorInternalServerWrap("encode weekly care request", err))
			return nil, false
		}
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return nil, false
	}
	return payload, true
}

func toCareRequestDiffResponses(entries []parentService.CareRequestDiffEntry) []ParentCareRequestDiffResponse {
	out := make([]ParentCareRequestDiffResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, ParentCareRequestDiffResponse{
			Label:    e.Label,
			Old:      e.Old,
			New:      e.New,
			Weekday:  e.Weekday,
			CareKind: e.CareKind,
			OldModes: e.OldModes,
			NewMode:  e.NewMode,
		})
	}
	return out
}

func toCareScheduleResponse(v *parentService.ChildCareSchedule) CareScheduleResponse {
	resp := CareScheduleResponse{
		Weekdays:   make([]CareScheduleWeekdayResponse, 0, len(v.Weekdays)),
		CanRequest: v.CanRequest,
		RequestCapabilities: CareScheduleRequestCapabilitiesResponse{
			Arrival:       v.RequestCapabilities.Arrival,
			Pickup:        v.RequestCapabilities.Pickup,
			DepartureMode: v.RequestCapabilities.DepartureMode,
		},
		TodayAbsent: v.TodayAbsent,
	}
	// Only the read view resolves today_absent, so only it carries a resolved
	// date; leave the write views' today_date empty (omitempty) rather than
	// emitting the zero Date's "0000-00-00" (#1725 review).
	if !v.TodayDate.IsZero() {
		resp.TodayDate = v.TodayDate.String()
	}
	for _, wd := range v.Weekdays {
		resp.Weekdays = append(resp.Weekdays, CareScheduleWeekdayResponse{
			Weekday: wd.Weekday,
			Status:  string(wd.Status),
			Arrival: wd.Arrival,
			Pickup:  wd.Pickup,
			Modes:   wd.Modes,
		})
	}
	if v.PendingRequest != nil {
		resp.PendingRequest = &PendingCareRequestResponse{
			ID:              ident.ID(v.PendingRequest.ID),
			CreatedAt:       v.PendingRequest.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			Diff:            toCareRequestDiffResponses(v.PendingRequest.Diff),
			SubmittedBySelf: v.PendingRequest.SubmittedBySelf,
			Version:         v.PendingRequest.Version,
		}
	}
	return resp
}

// getChildCareSchedule returns the child's permanent weekly care plan.
func (rs *Resource) getChildCareSchedule(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, ok := parsePathStudentID(w, r)
	if !ok {
		return
	}
	view, err := rs.ParentService.GetChildCareSchedule(r.Context(), accountID, studentID)
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toCareScheduleResponse(view), "Care schedule retrieved")
}

// createCareScheduleRequest stores a pending weekly-plan change request.
func (rs *Resource) createCareScheduleRequest(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	studentID, ok := parsePathStudentID(w, r)
	if !ok {
		return
	}
	var body CareScheduleRequestBody
	if err := wire.Decode(r.Body, &body); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}
	payload, ok := weeklyPayload(w, r, body.Payload)
	if !ok {
		return
	}
	view, err := rs.ParentService.CreateSignedCareScheduleRequest(r.Context(), accountID, studentID, payload, body.Signature.pickupInput())
	if err != nil {
		renderParentWriteError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, toCareScheduleResponse(view), "Care schedule request submitted")
}
