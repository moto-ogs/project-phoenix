package api

// The routes of the route catalog the contract does not register (ADR 0270,
// #7808). Every other route has a common.RouteContract beside its handler;
// these answer something the contract's JSON envelope cannot describe, or a
// caller outside the portals' catalog proxies. Each entry names a reason of a
// closed set and why it applies. TestEveryCatalogRouteHasAContractOrAReason
// fails on a catalog route that neither registers a contract nor stands here,
// on an entry that names a registered or a missing route, and on an entry
// without its reason. A new route that fits none of the reasons gets a
// contract (docs/agents/new-route.md).

// outsideReason is why a route stays outside the contract.
type outsideReason string

const (
	// outsideDevice: a device calls it with its own key, not a portal; the
	// kiosk (PyrePortal) reads numeric identifiers and its error codes.
	outsideDevice outsideReason = "device"
	// outsideWebDAV: a calendar app speaks WebDAV with XML bodies.
	outsideWebDAV outsideReason = "webdav"
	// outsideMetrics: Prometheus scrapes plain text.
	outsideMetrics outsideReason = "metrics"
	// outsideProbe: the load balancer and the container runtime probe the
	// process.
	outsideProbe outsideReason = "probe"
	// outsideSession: a sign-in, second-factor, renewal or switch step that
	// issues, renews or ends a session; the portal's own route file installs
	// the session cookie.
	outsideSession outsideReason = "session"
	// outsideStream: a server-sent event stream.
	outsideStream outsideReason = "stream"
	// outsidePublicAPI: a machine-to-machine API with its own published
	// description.
	outsidePublicAPI outsideReason = "public-api"
	// outsideWebhook: a provider posts its events.
	outsideWebhook outsideReason = "webhook"
	// outsideBrowserRoute: the portal's own route file must do something
	// around the call the proxy cannot: purge a BFF cache, read a flow
	// cookie, add the session's data to a public answer.
	outsideBrowserRoute outsideReason = "browser-route"
)

// outsideRoute names one catalog line ("METHOD /path"), or with prefix set
// every line without a contract whose path starts with line, whatever the
// method.
type outsideRoute struct {
	line   string
	prefix bool
	reason outsideReason
	why    string
}

// routesOutsideContract lists the catalog routes without a contract.
func routesOutsideContract() []outsideRoute {
	return append(append(append(
		outsideDeviceRoutes(), outsideProtocolRoutes()...),
		outsideSessionRoutes()...),
		outsideBrowserRoutes()...)
}

func outsideDeviceRoutes() []outsideRoute {
	const kiosk = "PyrePortal authenticates with the device key and staff PIN and reads numeric IDs (v1.11.5)"
	return []outsideRoute{
		{line: "/api/iot/", prefix: true, reason: outsideDevice, why: kiosk},
		{line: "POST /api/students/{id}/rfid", reason: outsideDevice, why: "PyrePortal assigns a tag with the device key"},
		{line: "DELETE /api/students/{id}/rfid", reason: outsideDevice, why: "PyrePortal removes a tag with the device key"},
		{line: "GET /api/display/dashboard", reason: outsideDevice, why: "the wall display sends its display token in a header, no session"},
	}
}

func outsideProtocolRoutes() []outsideRoute {
	return []outsideRoute{
		{line: "/api/caldav", prefix: true, reason: outsideWebDAV, why: "CalDAV clients send PROPFIND and REPORT with XML"},
		{line: "/.well-known/caldav", prefix: true, reason: outsideWebDAV, why: "RFC 6764 discovery redirects every method"},
		{line: "/internal/metrics", prefix: true, reason: outsideMetrics, why: "Prometheus text exposition"},
		{line: "GET /", reason: outsideProbe, why: "the bare host answers a probe"},
		{line: "GET /health", reason: outsideProbe, why: "liveness probe"},
		{line: "GET /ready", reason: outsideProbe, why: "readiness probe"},
		{line: "GET /api/sse/events", reason: outsideStream, why: "event stream of the staff portal"},
		{line: "GET /parent-sse/events", reason: outsideStream, why: "event stream of the parents portal"},
		{line: "GET /school-sse/events", reason: outsideStream, why: "event stream of moto schule"},
		{line: "/public/data-return/", prefix: true, reason: outsidePublicAPI, why: "data return to the school authority, described by its own OpenAPI document"},
		{line: "POST /webhooks/email/delivery/{provider}", reason: outsideWebhook, why: "the mail provider posts delivery events, signed per provider"},
	}
}

func outsideSessionRoutes() []outsideRoute {
	steps := []string{
		"POST /auth/login", "POST /auth/logout", "POST /auth/refresh", "POST /auth/session/validate",
		"POST /auth/mfa/enroll/confirm", "POST /auth/mfa/enroll/start", "POST /auth/mfa/resend", "POST /auth/mfa/verify",
		"POST /auth/passkeys/login/options", "POST /auth/passkeys/login/verify",
		"POST /auth/switch-tenant", "POST /auth/staff-preview", "POST /auth/staff-preview/end",
		"POST /auth/invitations/{token}/accept",
		"POST /caterer/auth/login", "POST /caterer/auth/mfa/resend", "POST /caterer/auth/mfa/verify",
		"POST /caterer/auth/passkeys/login/options", "POST /caterer/auth/passkeys/login/verify",
		"POST /caterer/account/mfa/confirm",
		"POST /operator/auth/login", "POST /operator/auth/logout", "POST /operator/auth/refresh",
		"POST /operator/auth/mfa/enroll/confirm", "POST /operator/auth/mfa/enroll/start",
		"POST /operator/auth/mfa/resend", "POST /operator/auth/mfa/verify",
		"POST /operator/auth/passkeys/login/options", "POST /operator/auth/passkeys/login/verify",
		"POST /operator/auth/invitations/accept",
		"POST /parent/auth/login", "POST /parent/auth/mfa/resend", "POST /parent/auth/mfa/verify",
		"POST /parent/me/mfa/confirm",
		"POST /school/auth/login", "POST /school/auth/mfa/enroll/confirm", "POST /school/auth/mfa/enroll/start",
		"POST /school/auth/mfa/resend", "POST /school/auth/mfa/verify",
		"POST /traeger/auth/login", "POST /traeger/auth/mfa/enroll/confirm", "POST /traeger/auth/mfa/enroll/start",
		"POST /traeger/auth/mfa/resend", "POST /traeger/auth/mfa/verify", "POST /traeger/auth/mfa/step-up/verify",
	}
	routes := make([]outsideRoute, 0, len(steps))
	for _, step := range steps {
		routes = append(routes, outsideRoute{
			line: step, reason: outsideSession,
			why: "the answer carries or ends the tokens the portal's route file turns into its session cookie",
		})
	}
	return routes
}

func outsideBrowserRoutes() []outsideRoute {
	const tenantCache = "the route file purges the cached tenant lookup after the write, so the login page shows the change"
	return []outsideRoute{
		{line: "PUT /api/settings/values/{key}", reason: outsideBrowserRoute, why: tenantCache},
		{line: "DELETE /api/settings/values/{key}", reason: outsideBrowserRoute, why: tenantCache},
		{line: "GET /api/settings/login-image", reason: outsideBrowserRoute, why: "served by the same route file as its writes"},
		{line: "POST /api/settings/login-image", reason: outsideBrowserRoute, why: tenantCache},
		{line: "DELETE /api/settings/login-image", reason: outsideBrowserRoute, why: tenantCache},
		{line: "PUT /operator/schools/{id}/settings/values/{key}", reason: outsideBrowserRoute, why: "the operator's route file purges the school's cached tenant lookup"},
		{line: "DELETE /operator/schools/{id}/settings/values/{key}", reason: outsideBrowserRoute, why: "the operator's route file purges the school's cached tenant lookup"},
		{line: "POST /operator/auth/invitations/validate", reason: outsideBrowserRoute, why: "the route file reads the invitation token from the flow cookie, never from the URL"},
		{line: "GET /api/enrollment/form-bootstrap/public/{tenantSlug}/{phaseId}", reason: outsideBrowserRoute, why: "the route file adds the signed-in staff member's profile to the public form"},
		{line: "GET /api/enrollment/me/profile", reason: outsideBrowserRoute, why: "read only by the form bootstrap's route file"},
	}
}
