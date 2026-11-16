package analytics

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
