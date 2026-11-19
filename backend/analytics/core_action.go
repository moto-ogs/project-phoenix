package analytics

import "net/http"

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
	return !action.EndedOnly || responseFlag(body, "ended")
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
