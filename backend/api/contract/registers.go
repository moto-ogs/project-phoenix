package contract

import (
	"reflect"
	"slices"
)

// Options are the two legacy registers of ADR 0270. Both only shrink: an
// entry leaves when its route is migrated, and Build fails on an entry that
// no registration uses.
type Options struct {
	// NumericIDs lists the identifier fields that existing routes still send
	// as JSON numbers, as "package.Type.GoField". Every other int64 on a
	// registered type must be a common.ID. On a request type the entry is a
	// field Go reads only as a JSON number.
	NumericIDs []string
	// QueryVariants lists the routes whose response shape a query parameter
	// selects, as "METHOD /pattern".
	QueryVariants []string
	// Identifiers maps the Go identifier types to KindID or KindLaxID. The
	// root names them, so this package stays free of the HTTP packages.
	Identifiers map[reflect.Type]string
	// Readers says what the own UnmarshalJSON of a request type reads:
	// ReadsFields or ReadsLaxIDs. A request type with its own UnmarshalJSON
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
	// ReadsLaxIDs: as ReadsFields, and every int64 field takes a JSON number
	// or a decimal string.
	ReadsLaxIDs = "lax_ids"
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
	// File, Multipart and TooLargeCode are the file traits of
	// common.RouteContract.
	File         bool
	Multipart    bool
	TooLargeCode string
	// PublicFile is the marker of common.RouteContract that opens one
	// file to the portal public.
	PublicFile   string
	PrivateCache bool
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

// legacyNumericIDs names the fields that still travel as numbers on the
// wire, as "package.Type.GoField".
// The list is kept in two files by package name, sorted.
var legacyNumericIDs = slices.Concat(legacyNumericIDsAToO, legacyNumericIDsPToZ)

// Legacy returns the registers of the routes registered today, with the
// identifier types the root names.
func Legacy(identifiers map[reflect.Type]string) Options {
	return Options{
		Identifiers:   identifiers,
		NumericIDs:    legacyNumericIDs,
		QueryVariants: []string{"GET /api/students/"},
	}
}
