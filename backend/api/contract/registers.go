package contract

import (
	"reflect"
)

// Options carry the types the root names and the one register of ADR 0270
// point 3. Build fails on an entry that no registration uses. Every int64 on
// a registered type is an ident.ID, or a count or an amount tagged
// contract:"number" (ADR 0300).
type Options struct {
	// QueryVariants lists the routes whose response shape a query parameter
	// selects, as "METHOD /pattern". It only shrinks: GET /api/students/ is
	// the one named debt of ADR 0270 point 3, and no route joins it.
	QueryVariants []string
	// Identifiers maps the Go identifier types to KindID. The root names
	// them, so this package stays free of the HTTP packages.
	Identifiers map[reflect.Type]string
	// Readers says what the own UnmarshalJSON of a request type reads:
	// ReadsFields or ReadsValue. A request type with its own UnmarshalJSON
	// and no entry stops the generator; the root names them like the
	// identifier types.
	Readers map[reflect.Type]string
	// Dates names the day types beside calendar.Date that travel as
	// "YYYY-MM-DD" and render their zero value as null. The root names them.
	Dates []reflect.Type
	// Instants names the instant types beside time.Time that write
	// themselves as RFC 3339 with an offset. The root names them.
	Instants []reflect.Type
}

const (
	// ReadsFields: the reader takes the fields as encoding/json would.
	ReadsFields = "fields"
	// ReadsValue: the type is a wrapper that reads one JSON value, null
	// included, into its field Value and notes that the key was present.
	ReadsValue = "value"
)

// Registration is one route as the root hands it over: the owner's
// common.RouteContract with its full pattern.
type Registration struct {
	Method           string
	Pattern          string
	Portals          []string
	Query            []QueryParam
	Request          any
	Response         any
	Paginated        bool
	NoData           bool
	Variants         *VariantSpec
	Enums            []EnumSpec
	Deprecated       bool
	DeprecatedFields []string
	// NoRetryAfterRenewal and MaxBodyBytes are the proxy traits of
	// common.RouteContract.
	NoRetryAfterRenewal string
	MaxBodyBytes        int
	// NoCommit is the marker of common.RouteContract for a POST that commits
	// nothing its caller asked for.
	NoCommit string
	// File, Multipart and TooLargeCode are the file traits of
	// common.RouteContract.
	File         bool
	Multipart    bool
	TooLargeCode string
	// PublicFile is the marker of common.RouteContract that opens one
	// file to the portal public.
	PublicFile string
	// PublicUpload is the marker that opens one upload to the portal public.
	PublicUpload string

	// FileCache and ConditionalGet are the cache traits of a file route.
	FileCache      string
	ConditionalGet bool
	PrivateCache   bool
}

// VariantSpec is a response whose shape a query parameter selects.
type VariantSpec struct {
	QueryParam string
	Default    string
	ByValue    map[string]any
}

// EnumSpec names a closed set of string values by Go type or by field.
type EnumSpec struct {
	Name   string
	Type   any
	Fields []string
	Values []string
}
