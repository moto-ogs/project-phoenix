package analytics

import (
	"bytes"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// RouteKey is one route of the HTTP API as chi reports it: the method and
// the route pattern, never a concrete path.
type RouteKey struct {
	Method  string
	Pattern string
}

// CoreAction classifies one writing route for the usage analytics (spec
// #3598, "Kernaktionen per Middleware"). An empty Event means the route is
// deliberately not captured.
type CoreAction struct {
	Event string
	// CreatedOnly captures an event only when the standard response envelope
	// carries data.created=true. Idempotent writes return created=false and
	// must not be counted as another completed core action.
	CreatedOnly bool
	// EndedOnly captures an event only when the response envelope carries
	// data.ended=true. An idempotent end that ended nothing answers
	// ended=false and is no core action.
	EndedOnly bool
	// Flag captures an event only when the response envelope carries
	// data.<Flag>=true: a write that can switch something on and off counts
	// only the direction it names (a dismissal, not taking it back).
	Flag string
	// StepFromRoute: the route's `{step}` names a step of a checklist, and
	// the event counts only when the response lists that step under
	// data.steps with skipped=true. The step key goes out as `step`; it is
	// taken from the server's own step list, never a free value.
	StepFromRoute bool
	// Session: the response mints a session (login, demo entry); the actor
	// comes from its access token, and a 2xx without one sends nothing.
	Session bool
	// Surface names the portal of a route whose request carries no session
	// (a public form). It is the fallback when no session tells it.
	Surface string
	// ExportType is the only property a data export adds; it names the
	// export by its route, never by the request body.
	ExportType string
	// SchoolFromRoute: a caterer names no school in its session (it may
	// supply several), so the event counts for the school in the route's
	// `schoolId`. Only a 2xx reaches capture, so the handler has accepted
	// that school for the caterer; the school's switch then gates the event.
	SchoolFromRoute bool
	// Detail derives the event's fixed values from a 2xx response, its route
	// and its query (#7553): the event name from a closed set and properties
	// whose values come from closed lists, never a free value or an ID. It
	// returns false when the response completed nothing worth counting.
	Detail func(r *http.Request, body []byte) (event string, props map[string]string, ok bool)
	// details are the properties Detail derived for one request.
	details map[string]string
}

var notCaptured = CoreAction{}

func event(name string) CoreAction { return CoreAction{Event: name} }
func createdEvent(name string) CoreAction {
	return CoreAction{Event: name, CreatedOnly: true}
}
func endedEvent(name string) CoreAction {
	return CoreAction{Event: name, EndedOnly: true}
}
func flaggedEvent(name, flag string) CoreAction {
	return CoreAction{Event: name, Flag: flag}
}
func skippedStepEvent(name string) CoreAction {
	return CoreAction{Event: name, StepFromRoute: true}
}
func session(name string) CoreAction { return CoreAction{Event: name, Session: true} }
func sessionOr(name, surface string) CoreAction {
	return CoreAction{Event: name, Session: true, Surface: surface}
}
func public(name string) CoreAction { return CoreAction{Event: name, Surface: SurfacePublic} }
func catererEvent(name string) CoreAction {
	return CoreAction{Event: name, Surface: SurfaceCaterer, SchoolFromRoute: true}
}
func export(exportType string) CoreAction {
	return CoreAction{Event: "data_exported", ExportType: exportType}
}

// countsResponse reports whether a 2xx response completed the action: an
// idempotent write that changed nothing (CreatedOnly, EndedOnly) does not.
func (action CoreAction) countsResponse(body []byte) bool {
	if action.CreatedOnly && !responseFlag(body, "created") {
		return false
	}
	if action.Flag != "" && !responseFlag(body, action.Flag) {
		return false
	}
	return !action.EndedOnly || responseFlag(body, "ended")
}

// responseProperties reports whether a 2xx response completed the action and
// returns what the event adds from it: the skipped step of a checklist.
func (action CoreAction) responseProperties(r *http.Request, body []byte) (map[string]any, bool) {
	if !action.countsResponse(body) {
		return nil, false
	}
	if !action.StepFromRoute {
		return nil, true
	}
	step, ok := skippedStep(body, chi.URLParam(r, "step"))
	if !ok {
		return nil, false
	}
	return map[string]any{"step": step}, true
}

// skippedStep returns the key of a step the response lists as skipped
// (data.steps[].key, data.steps[].skipped). A step the response does not
// list, or lists as not skipped, is no skip: an unknown key or a skip taken
// back counts nothing.
func skippedStep(body []byte, step string) (string, bool) {
	var response struct {
		Data struct {
			Steps []struct {
				Key     string `json:"key"`
				Skipped bool   `json:"skipped"`
			} `json:"steps"`
		} `json:"data"`
	}
	if step == "" || json.Unmarshal(bytes.TrimSpace(body), &response) != nil {
		return "", false
	}
	for _, listed := range response.Data.Steps {
		if listed.Key == step {
			return listed.Key, listed.Skipped
		}
	}
	return "", false
}

// detailed applies Detail to one 2xx response. A cut body is never parsed,
// so it counts nothing.
func (action CoreAction) detailed(r *http.Request, body *cappedBuffer) (CoreAction, bool) {
	if action.Detail == nil {
		return action, true
	}
	if body.overflow {
		return action, false
	}
	event, details, ok := action.Detail(r, body.Bytes())
	if !ok || event == "" {
		return action, false
	}
	action.Event = event
	action.details = details
	return action, true
}
