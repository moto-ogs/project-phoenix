// Package contractmodel is the model of the frontend/backend contract
// (ADR 0270) and decides whether an answer keeps it. api/contract builds the
// model from the typed route registrations and writes the TypeScript side;
// the test build of api/common holds every handler answer against it.
package contractmodel

// Kinds of a value on the wire.
const (
	KindString  = "string"
	KindBool    = "bool"
	KindInt     = "int"     // JSON number, safe integer
	KindNumber  = "number"  // JSON number
	KindID      = "id"      // identifier as a JSON string
	KindDate    = "date"    // YYYY-MM-DD
	KindInstant = "instant" // RFC 3339
	KindClock   = "clock"   // wall-clock time as HH:MM
	KindEnum    = "enum"
	KindArray   = "array"
	KindMap     = "map"
	KindRef     = "ref"
	KindJSON    = "json" // any JSON value the owner stores and hands on unread
)

// Schema is one value on the wire.
type Schema struct {
	Kind       string  `json:"kind"`
	Nullable   bool    `json:"nullable,omitempty"`
	LegacyJSON bool    `json:"legacy_json,omitempty"`
	Elem       *Schema `json:"elem,omitempty"`
	// Ref names the object of a KindRef or the enum of a KindEnum.
	Ref string `json:"ref,omitempty"`
}

// Field is one member of an object. Optional means the key may be absent.
type Field struct {
	Name        string `json:"name"`
	Optional    bool   `json:"optional,omitempty"`
	Deprecated  bool   `json:"deprecated,omitempty"`
	JSONReason  string `json:"json_reason,omitempty"`
	RefinesJSON string `json:"refines_json,omitempty"`
	TextReason  string `json:"text_reason,omitempty"`
	Schema      Schema `json:"schema"`
}

// Object is one Go struct as it renders.
type Object struct {
	Name   string `json:"name"`
	GoType string `json:"go_type"`
	// Request marks a bound body: Go accepts every field as absent.
	Request bool    `json:"request,omitempty"`
	Fields  []Field `json:"fields"`
}

// Enum is a closed set of string values the owner registered.
type Enum struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

// QueryParam is one query parameter of a route.
type QueryParam struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Repeated bool     `json:"repeated,omitempty"`
	Values   []string `json:"values,omitempty"`
}

// Variants is a response whose shape a query parameter selects.
type Variants struct {
	QueryParam string            `json:"query_param"`
	Default    string            `json:"default"`
	Cases      map[string]Schema `json:"cases"`
}

// Route is one registered route.
type Route struct {
	Method     string       `json:"method"`
	Pattern    string       `json:"pattern"`
	Portals    []string     `json:"portals"`
	Deprecated bool         `json:"deprecated,omitempty"`
	Paginated  bool         `json:"paginated,omitempty"`
	Query      []QueryParam `json:"query,omitempty"`
	Request    *Schema      `json:"request,omitempty"`
	Response   *Schema      `json:"response,omitempty"`
	// PartialError names a problem whose details.result reuses Response.
	PartialError string `json:"partial_error,omitempty"`
	// NoData says the route answers a 204 or the envelope without data.
	NoData   bool      `json:"no_data,omitempty"`
	Variants *Variants `json:"variants,omitempty"`
	// NoRetryAfterRenewal says why the proxy sends the request only once,
	// also when it renewed the session after a 401.
	NoRetryAfterRenewal string `json:"no_retry_after_renewal,omitempty"`
	// MaxBodyBytes is the largest request body the proxy reads.
	MaxBodyBytes int `json:"max_body_bytes,omitempty"`
	// NoCommit says why a POST commits nothing its caller asked for; its
	// unreadable answer may be retried like a GET's.
	NoCommit string `json:"no_commit,omitempty"`
	// File says the route answers a file instead of the envelope.
	File bool `json:"file,omitempty"`
	// Multipart says the request body is a multipart/form-data upload the
	// proxy streams through.
	Multipart bool `json:"multipart,omitempty"`
	// TooLargeCode is the error code of a multipart body over MaxBodyBytes.
	TooLargeCode string `json:"too_large_code,omitempty"`
	// PublicFile says why a file of the portal public may leave without a
	// session; the proxy serves no other public file.
	PublicFile string `json:"public_file,omitempty"`
	// PublicUpload says why an upload of the portal public may arrive
	// without a session; the proxy takes no other public upload.
	PublicUpload string `json:"public_upload,omitempty"`

	// FileCache is the Cache-Control the proxy sets on a file the backend
	// handed out (a 2xx answer, or 304 on a ConditionalGet route); every
	// other answer stays private and uncached. One of FileCacheValues.
	FileCache string `json:"file_cache,omitempty"`
	// ConditionalGet lets the proxy forward If-None-Match and
	// If-Modified-Since and hand a 304 with its validators back.
	ConditionalGet bool `json:"conditional_get,omitempty"`
	// PrivateCache says the proxy passes a file's private Cache-Control on
	// instead of private, no-store.
	PrivateCache bool `json:"private_cache,omitempty"`
	// RouteFile says why the portal's own route file, not the catalog
	// proxy, serves the route. No proxy allowlist names it.
	RouteFile          string `json:"route_file,omitempty"`
	BrowserPath        string `json:"browser_path,omitempty"`
	BrowserMethod      string `json:"browser_method,omitempty"`
	BrowserOwnContract bool   `json:"browser_own_contract,omitempty"`
	// Plain says the route answers its data as the whole body, without the
	// envelope. Only a route file reads such an answer.
	Plain bool `json:"plain,omitempty"`
}

// OutsideRoute is a catalog line the contract does not type: no portal's
// JSON, or a caller of its own (#7808).
type OutsideRoute struct {
	Method  string `json:"method"`
	Pattern string `json:"pattern"`
	// Reason is one of OutsideReasons.
	Reason string `json:"reason"`
	// Why says in one sentence why the reason applies.
	Why string `json:"why"`
}

// Key is the route's line in the route catalog.
func (r OutsideRoute) Key() string { return r.Method + " " + r.Pattern }

// The reasons a catalog line stays outside the contract (#7808). The list is
// closed: a line that fits none is typed, as a proxied route or one a route
// file serves.
const (
	// OutsideDevice: the kiosk (PyrePortal) calls it with its device key and
	// reads numeric identifiers.
	OutsideDevice = "device"
	// OutsideWebDAV: a calendar app speaks WebDAV with XML bodies.
	OutsideWebDAV = "webdav"
	// OutsideMetrics: Prometheus scrapes plain text.
	OutsideMetrics = "metrics"
	// OutsideProbe: the load balancer and the container runtime probe the
	// process.
	OutsideProbe = "probe"
	// OutsideStream: a server-sent event stream.
	OutsideStream = "stream"
	// OutsidePublicAPI: a machine-to-machine API with its own published
	// description.
	OutsidePublicAPI = "public-api"
	// OutsideWebhook: a provider posts its events.
	OutsideWebhook = "webhook"
)

// OutsideReasons is the closed set of OutsideRoute reasons.
var OutsideReasons = []string{OutsideDevice, OutsideWebDAV, OutsideMetrics, OutsideProbe, OutsideStream, OutsidePublicAPI, OutsideWebhook}

// The Cache-Control values a file route may name (#2352, ADR 0270). The
// list is closed: a value the proxy would hand a browser is reviewed here.
const (
	// FileCachePublicAsset lets any cache keep a public asset for a day: a
	// school's login image or legal text, no personal data. Only a route
	// with PublicFile may name it.
	FileCachePublicAsset = "public, max-age=86400"
	// FileCachePrivateHour lets the subscriber's own client keep a feed for
	// an hour; no shared cache stores it.
	FileCachePrivateHour = "private, max-age=3600"
	// FileCachePrivateImmutableDay lets the viewer's browser keep bytes that
	// never change behind their URL for a day; no shared cache stores them.
	FileCachePrivateImmutableDay = "private, max-age=86400, immutable"
)

// FileCacheValues is the closed set of FileCache values.
var FileCacheValues = []string{FileCachePublicAsset, FileCachePrivateHour, FileCachePrivateImmutableDay}

// Key is the route's line in the route catalog.
func (r Route) Key() string { return r.Method + " " + r.Pattern }

// Document is the whole contract. It is committed as contract.json, and the
// comparison with the base branch reads it.
type Document struct {
	ProblemDetails map[string]Schema `json:"problem_details,omitempty"`
	StreamEvent    *Schema           `json:"stream_event,omitempty"`
	Routes         []Route           `json:"routes"`
	// Outside lists the catalog lines without a contract, with their reason.
	Outside []OutsideRoute `json:"outside"`
	Enums   []Enum         `json:"enums"`
	Types   []Object       `json:"types"`
}
