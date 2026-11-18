// Package contractmodel is the model of the frontend/backend contract
// (ADR 0270) and decides whether an answer keeps it. api/contract builds the
// model from the typed route registrations and writes the TypeScript side;
// the test build of api/common holds every handler answer against it.
package contractmodel

// Kinds of a value on the wire.
const (
	KindString   = "string"
	KindBool     = "bool"
	KindInt      = "int"       // JSON number, safe integer
	KindNumber   = "number"    // JSON number
	KindID       = "id"        // identifier as a JSON string
	KindLegacyID = "legacy_id" // identifier an existing route still sends, or reads only, as a JSON number
	KindLaxID    = "lax_id"    // common.JSONID: renders a number, reads number or string
	KindDate     = "date"      // YYYY-MM-DD
	KindInstant  = "instant"   // RFC 3339
	KindClock    = "clock"     // wall-clock time as HH:MM
	KindEnum     = "enum"
	KindArray    = "array"
	KindMap      = "map"
	KindRef      = "ref"
	// KindJSON is any JSON value the contract does not describe: a
	// json.RawMessage the backend passes through as it was stored.
	KindJSON = "json"
)

// Schema is one value on the wire.
type Schema struct {
	Kind     string  `json:"kind"`
	Nullable bool    `json:"nullable,omitempty"`
	Elem     *Schema `json:"elem,omitempty"`
	// Ref names the object of a KindRef or the enum of a KindEnum.
	Ref string `json:"ref,omitempty"`
}

// Field is one member of an object. Optional means the key may be absent.
type Field struct {
	Name       string `json:"name"`
	Optional   bool   `json:"optional,omitempty"`
	Deprecated bool   `json:"deprecated,omitempty"`
	Schema     Schema `json:"schema"`
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
	// NoData says the route answers a 204 or the envelope without data.
	NoData   bool      `json:"no_data,omitempty"`
	Variants *Variants `json:"variants,omitempty"`
}

// Key is the route's line in the route catalog.
func (r Route) Key() string { return r.Method + " " + r.Pattern }

// Document is the whole contract. It is committed as contract.json, and the
// comparison with the base branch reads it.
type Document struct {
	Routes []Route  `json:"routes"`
	Enums  []Enum   `json:"enums"`
	Types  []Object `json:"types"`
}
