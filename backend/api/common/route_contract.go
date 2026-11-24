package common

import (
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
)

// PortalScope names a portal whose proxy may reach a route. For a session
// portal the value is the scope claim of that portal's session token;
// PortalPublic admits no session at all.
type PortalScope string

const (
	// PortalTenant is the school staff portal.
	PortalTenant PortalScope = "tenant"
	// PortalParent is the guardians' portal, across every school of a guardian.
	PortalParent PortalScope = "parent"
	// PortalSchool is moto schule, the teachers' portal of one school.
	PortalSchool PortalScope = "school"
	// PortalTraeger is the Träger-Portal, bound to a Träger and no school.
	PortalTraeger PortalScope = "org"
	// PortalCaterer is the caterer portal, bound to no school.
	PortalCaterer PortalScope = "caterer"
	// PortalOperator is the operator portal of the moto team.
	PortalOperator PortalScope = "platform"
	// PortalPublic is no portal of its own: the routes a request reaches
	// without a session (a mailed link, a public form). Every portal's proxy
	// serves those under its mount on a path that reads no session and sends
	// no bearer (#2352). A public route names no other portal.
	PortalPublic PortalScope = "public"
)

// RouteContract is the typed registration of one route (ADR 0270): what the
// route catalog's METHOD /pattern line does not say. The owner's http role
// declares it with a pattern relative to its mount; the root adds the mount
// and checks the result against the catalog.
type RouteContract struct {
	Method  string
	Pattern string
	// Portals lists every portal that may reach the route.
	Portals []PortalScope
	// Query lists every query parameter the handler reads.
	Query []QueryParam
	// Request is a zero value of the bound body type; nil without a body.
	Request any
	// Response is a zero value of the type rendered as the envelope's data.
	Response any
	// PartialError names a problem whose details.result reuses Response.
	PartialError string
	// Paginated says the route answers through RespondPaginated.
	Paginated bool
	// NoData replaces Response on a route that answers no data: a 204, or
	// the envelope without a data member.
	NoData bool
	// Variants replaces Response on a legacy route whose query selects the
	// response shape. New routes may not use it.
	Variants *ResponseVariants
	// Enums names the closed value sets of this route's types.
	Enums []EnumContract
	// Deprecated announces the removal of the route one release ahead.
	Deprecated bool
	// Refuses says why a Deprecated route answers every request with a
	// refusal: an old write kept for its release (ADR 0270) that carries no
	// read state, so a tab from before the release reloads (ADR 0311). It
	// has no success answer; a test that sees its refusal answers it.
	Refuses string
	// DeprecatedFields announces the removal of fields one release ahead, as
	// "GoType.json_name".
	DeprecatedFields []string
	// NoRetryAfterRenewal says why the portal's proxy must not send the
	// request again after it renewed an expired session: the first call may
	// already have acted (mailed a code, checked a password). Empty allows
	// the retry.
	NoRetryAfterRenewal string
	// MaxBodyBytes is the largest request body the proxy reads; it answers a
	// larger one 413 without calling the backend. Zero sets no limit.
	MaxBodyBytes int
	// NoCommit says why a POST commits none of the changes its caller could
	// ask for: a preview, a search or a read with a body. When its answer
	// does not match the contract, the proxy offers a retry instead of asking
	// to reload a change that may have been saved. Only a POST names it. It
	// is not the read-only preview session's allowlist (readonly_preview.go):
	// an import preview commits no import but writes an audit row.
	NoCommit string
	// File replaces Response on a route that answers a file: its bytes with
	// Content-Type and Content-Disposition instead of the envelope. The proxy
	// streams them through; FileCache and PrivateCache govern caching.
	// An error keeps the problem envelope.
	File bool
	// Multipart replaces Request on a route that takes a multipart/form-data
	// upload. The proxy streams the body to the backend without reading it,
	// sends it once (no retry after a session renewal) and needs
	// MaxBodyBytes and TooLargeCode. MaxBodyBytes leaves room for the
	// multipart frame, so a file a little too large still reaches the
	// backend's own check.
	Multipart bool
	// PrivateCache lets a file stay in the browser's own cache: the proxy
	// passes the handler's Cache-Control on when it is private, for an image
	// whose address carries its version. Any other value, a public one
	// included, and every refusal leave as private, no-store. Only a File
	// route may set it.
	PrivateCache bool
	// TooLargeCode is the registered error code the proxy answers a multipart
	// body over MaxBodyBytes with: the code the backend answers a too large
	// file with, so the client shows the same text.
	TooLargeCode string
	// PublicFile opens a file to the portal public, route by route
	// (#2352, ADR 0270): it says why the link in the path alone may hand out
	// the file. The proxy sends no session, no bearer and no body, and the
	// backend's limiter of the link keys the request by client IP. Only a
	// File route of the portal public names it; a public file without it is
	// refused. Public multipart uploads use PublicUpload instead.
	PublicFile string
	// PublicUpload opens a multipart upload to the portal public, route by
	// route (#2352, ADR 0270): it says why a link or a public form may send
	// a file without a session. The proxy checks the body's length before
	// the backend call, streams it without cookie, bearer or idempotency
	// key, and the backend counts the attempt by client IP before it reads
	// the body. Only a Multipart route of the portal public names it.
	PublicUpload string

	// FileCache is the Cache-Control the proxy keeps on a file the backend
	// handed out, route by route (#2352, ADR 0270): one of the FileCache*
	// values. Without it every answer of a file route is private and
	// uncached. A public value needs PublicFile.
	FileCache string
	// ConditionalGet lets the proxy forward If-None-Match and
	// If-Modified-Since to a GET file route and hand its 304 back with
	// ETag, Last-Modified and FileCache. It needs FileCache.
	ConditionalGet bool

	// RouteFile says why the portal's own Next route file, not its catalog
	// proxy, serves this JSON route (#7808): it turns a token pair into the
	// session cookie, purges a cache after the write, or reads a flow
	// cookie. The route is typed like any other, and no proxy allowlist
	// names it, so the proxy never hands its answer to a browser.
	RouteFile string
	// BrowserPath is the exact same-origin address of a RouteFile route. An
	// empty path leaves the Go entry available only to server callers.
	BrowserPath string
	// BrowserMethod overrides the Go method at BrowserPath; empty uses Method.
	BrowserMethod string
	// BrowserOwnContract marks a route file that changes the browser's
	// request or answer. The address is typed, not the Go body or answer.
	BrowserOwnContract bool
	// Plain says the handler writes the data as the whole body
	// (RenderJSON), without the envelope. Only a RouteFile route may.
	Plain bool
	// Outside keeps a catalog line out of the contract (#7808): no portal
	// calls it for JSON. It names no portal, type or trait.
	Outside *Outside
}

// RouteFileSession is the RouteFile reason of a sign-in, second-factor,
// renewal, switch or end step: its answer carries or ends the tokens the
// portal's route file turns into its session cookie.
const RouteFileSession = "the answer carries or ends the tokens the portal's route file turns into its session cookie"

// OutsideReason is why a catalog line stays outside the contract; the set
// is closed (contractmodel.OutsideReasons).
type OutsideReason string

// The reasons a catalog line may stay outside the contract.
const (
	// OutsideDevice: the kiosk (PyrePortal) calls it with its device key and
	// reads numeric identifiers.
	OutsideDevice OutsideReason = contractmodel.OutsideDevice
	// OutsideWebDAV: a calendar app speaks WebDAV with XML bodies.
	OutsideWebDAV OutsideReason = contractmodel.OutsideWebDAV
	// OutsideMetrics: Prometheus scrapes plain text.
	OutsideMetrics OutsideReason = contractmodel.OutsideMetrics
	// OutsideProbe: the load balancer and the container runtime probe the
	// process.
	OutsideProbe OutsideReason = contractmodel.OutsideProbe
	// OutsideStream: a server-sent event stream.
	OutsideStream OutsideReason = contractmodel.OutsideStream
	// OutsidePublicAPI: a machine-to-machine API with its own published
	// description.
	OutsidePublicAPI OutsideReason = contractmodel.OutsidePublicAPI
	// OutsideWebhook: a provider posts its events.
	OutsideWebhook OutsideReason = contractmodel.OutsideWebhook
)

// Outside is the reason of a catalog line without a contract and one
// sentence why it applies.
type Outside struct {
	Reason OutsideReason
	Why    string
}

// OutsideRoutes registers catalog lines of one reason outside the contract,
// each as "METHOD /pattern" relative to the mount.
func OutsideRoutes(reason OutsideReason, why string, lines ...string) []RouteContract {
	routes := make([]RouteContract, 0, len(lines))
	for _, line := range lines {
		method, pattern, _ := strings.Cut(line, " ")
		routes = append(routes, RouteContract{Method: method, Pattern: pattern, Outside: &Outside{Reason: reason, Why: why}})
	}
	return routes
}

// The Cache-Control values a file route may name in FileCache; the handler
// sends the same value, so a direct call and the proxy agree.
const (
	FileCachePublicAsset         = contractmodel.FileCachePublicAsset
	FileCachePrivateHour         = contractmodel.FileCachePrivateHour
	FileCachePrivateImmutableDay = contractmodel.FileCachePrivateImmutableDay
)

// QueryKind is the value form of a query parameter.
type QueryKind string

const (
	QueryString QueryKind = "string"
	QueryInt    QueryKind = "int"
	QueryBool   QueryKind = "bool"
	QueryDate   QueryKind = "date"
	QueryID     QueryKind = "id"
)

// QueryParam is one query parameter a handler reads.
type QueryParam struct {
	Name string
	Kind QueryKind
	// Repeated says the handler reads every occurrence of the key.
	Repeated bool
	// Values closes a string parameter to these values.
	Values []string
}

// ResponseVariants describes a response whose shape a query parameter
// selects. The payload carries no discriminator.
type ResponseVariants struct {
	QueryParam string
	Default    string
	ByValue    map[string]any
}

// EnumContract names a closed set of string values. Reflection cannot see
// constants, so the owner states them. Type is a zero value of a named string
// type; Fields names plain string fields as "GoType.json_name".
type EnumContract struct {
	Name   string
	Type   any
	Fields []string
	Values []string
}
