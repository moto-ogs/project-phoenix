package contract

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var (
	marshalerType   = reflect.TypeFor[json.Marshaler]()
	unmarshalerType = reflect.TypeFor[json.Unmarshaler]()
	timeType        = reflect.TypeFor[time.Time]()
	rawJSONType     = reflect.TypeFor[json.RawMessage]()
	dateType        = reflect.TypeFor[calendar.Date]()
)

type builder struct {
	types        map[string]Object
	names        map[reflect.Type]string
	enums        map[string]Enum
	enumByType   map[reflect.Type]string
	enumByField  map[string]string
	deprecated   map[string]bool
	identifiers  map[reflect.Type]string
	readers      map[reflect.Type]string
	dates        map[reflect.Type]bool
	instants     map[reflect.Type]bool
	used         map[string]bool
	requestTypes map[string]bool
}

// Build walks the registrations with reflection, following encoding/json.
// Routes carry their full pattern.
func Build(routes []Registration, options Options) (Document, error) {
	b := &builder{
		types: map[string]Object{}, names: map[reflect.Type]string{}, enums: map[string]Enum{},
		enumByType: map[reflect.Type]string{}, enumByField: map[string]string{},
		deprecated: map[string]bool{}, used: map[string]bool{},
		requestTypes: map[string]bool{}, identifiers: options.Identifiers, readers: options.Readers,
		dates: map[reflect.Type]bool{dateType: true}, instants: map[reflect.Type]bool{timeType: true},
	}
	for _, t := range options.Dates {
		b.dates[t] = true
	}
	for _, t := range options.Instants {
		b.instants[t] = true
	}
	for _, rc := range routes {
		if err := b.registerEnums(rc); err != nil {
			return Document{}, err
		}
		for _, field := range rc.DeprecatedFields {
			b.deprecated[field] = true
		}
	}
	built, err := b.routes(routes, options)
	if err != nil {
		return Document{}, err
	}
	doc := Document{Routes: built}
	if err := b.unused(options); err != nil {
		return Document{}, err
	}
	for _, object := range b.types {
		doc.Types = append(doc.Types, object)
	}
	for _, enum := range b.enums {
		doc.Enums = append(doc.Enums, enum)
	}
	sort.Slice(doc.Types, func(i, j int) bool { return doc.Types[i].Name < doc.Types[j].Name })
	sort.Slice(doc.Enums, func(i, j int) bool { return doc.Enums[i].Name < doc.Enums[j].Name })
	sort.Slice(doc.Routes, func(i, j int) bool { return doc.Routes[i].Key() < doc.Routes[j].Key() })
	return doc, nil
}

// routes builds every registration once and refuses what the public proxy
// path cannot serve.
func (b *builder) routes(registrations []Registration, options Options) ([]Route, error) {
	var routes []Route
	seen := map[string]bool{}
	for _, rc := range registrations {
		route, err := b.route(rc, options)
		if err != nil {
			return nil, err
		}
		if seen[route.Key()] {
			return nil, fmt.Errorf("%s is registered twice", route.Key())
		}
		seen[route.Key()] = true
		routes = append(routes, route)
	}
	return routes, publicRoutesStandApart(routes)
}

func (b *builder) registerEnums(rc Registration) error {
	for _, enum := range rc.Enums {
		name, err := b.enumName(enum)
		if err != nil {
			return fmt.Errorf("%s %s: %w", rc.Method, rc.Pattern, err)
		}
		values := slices.Clone(enum.Values)
		sort.Strings(values)
		if existing, ok := b.enums[name]; ok && !slices.Equal(existing.Values, values) {
			return fmt.Errorf("enum %s is registered with different values", name)
		}
		b.enums[name] = Enum{Name: name, Values: values}
		for _, field := range enum.Fields {
			b.enumByField[field] = name
		}
	}
	return nil
}

// enumName names an enum after its Go type unless the owner named it.
func (b *builder) enumName(enum EnumSpec) (string, error) {
	name := enum.Name
	if enum.Type != nil {
		t := reflect.TypeOf(enum.Type)
		if t.Kind() != reflect.String || t.Name() == "" {
			return "", fmt.Errorf("enum %s: %s is not a named string type", enum.Name, t)
		}
		if name == "" {
			name = t.Name()
		}
		b.enumByType[t] = name
	}
	if name == "" || len(enum.Values) == 0 {
		return "", errors.New("an enum needs a name and values")
	}
	return name, nil
}

func (b *builder) route(rc Registration, options Options) (Route, error) {
	route := Route{
		Method: rc.Method, Pattern: rc.Pattern, Paginated: rc.Paginated, Deprecated: rc.Deprecated,
		NoRetryAfterRenewal: rc.NoRetryAfterRenewal, MaxBodyBytes: rc.MaxBodyBytes, NoCommit: rc.NoCommit,
		File: rc.File, Multipart: rc.Multipart, TooLargeCode: rc.TooLargeCode, PublicFile: rc.PublicFile, PublicUpload: rc.PublicUpload,
		FileCache: rc.FileCache, ConditionalGet: rc.ConditionalGet,
		PrivateCache: rc.PrivateCache,
	}
	where := route.Key()
	if rc.Method == "" || !strings.HasPrefix(rc.Pattern, "/") {
		return route, fmt.Errorf("invalid route registration %q", where)
	}
	if rc.MaxBodyBytes < 0 || (rc.MaxBodyBytes > 0 && rc.Request == nil && !rc.Multipart) {
		return route, fmt.Errorf("%s: a body limit needs a positive size and a request body", where)
	}
	if err := multipartTraits(rc, where); err != nil {
		return route, err
	}
	if err := fileCacheTraits(rc, where); err != nil {
		return route, err
	}
	if err := retryTraits(rc, where); err != nil {
		return route, err
	}
	if len(rc.Portals) == 0 {
		return route, fmt.Errorf("%s names no portal", where)
	}
	route.Portals = slices.Clone(rc.Portals)
	sort.Strings(route.Portals)
	query, err := queryParams(rc.Query, where)
	if err != nil {
		return route, err
	}
	route.Query = query
	if rc.Request != nil {
		s, err := b.top(rc.Request, where, true)
		if err != nil {
			return route, err
		}
		route.Request = &s
	}
	return route, b.responses(&route, rc, options)
}

func queryParams(params []QueryParam, where string) ([]QueryParam, error) {
	var query []QueryParam
	for _, param := range params {
		if param.Name == "" || param.Kind == "" {
			return nil, fmt.Errorf("%s: a query parameter needs a name and a kind", where)
		}
		values := slices.Clone(param.Values)
		sort.Strings(values)
		query = append(query, QueryParam{Name: param.Name, Kind: param.Kind, Repeated: param.Repeated, Values: values})
	}
	sort.Slice(query, func(i, j int) bool { return query[i].Name < query[j].Name })
	return query, nil
}

// multipartTraits refuses an upload the proxy cannot stream: one without a
// bound, without the code of its refusal, beside a JSON body or file answer,
// or with a retry trait although an upload is sent only once.
// retryTraits checks the traits that decide what the proxy may repeat or
// keep: NoCommit on a POST only, PrivateCache on a file of a session portal.
func retryTraits(rc Registration, where string) error {
	if rc.NoCommit != "" && rc.Method != "POST" {
		return fmt.Errorf("%s: only a POST names NoCommit; a GET commits nothing anyway and a PUT, PATCH or DELETE changes", where)
	}
	if rc.PrivateCache && (!rc.File || slices.Contains(rc.Portals, PublicPortal)) {
		return fmt.Errorf("%s: PrivateCache belongs to a file route of a session portal", where)
	}
	return nil
}

func multipartTraits(rc Registration, where string) error {
	if !rc.Multipart {
		if rc.TooLargeCode != "" {
			return fmt.Errorf("%s: TooLargeCode belongs to a multipart upload", where)
		}
		return nil
	}
	switch {
	case !slices.Contains([]string{"POST", "PUT", "PATCH"}, rc.Method):
		return fmt.Errorf("%s: a multipart upload is a POST, PUT or PATCH", where)
	case rc.Request != nil:
		return fmt.Errorf("%s registers a multipart upload and a JSON request body", where)
	case rc.File:
		return fmt.Errorf("%s: a multipart upload cannot answer a file", where)
	case rc.MaxBodyBytes == 0 || rc.TooLargeCode == "":
		return fmt.Errorf("%s: a multipart upload needs MaxBodyBytes and TooLargeCode", where)
	case rc.NoRetryAfterRenewal != "":
		return fmt.Errorf("%s: a multipart upload is sent once; drop NoRetryAfterRenewal", where)
	}
	return nil
}

// withoutData handles the two answers that carry no data member: a file and
// no data. It reports whether the registration was one of them.
func withoutData(route *Route, rc Registration) (bool, error) {
	data := rc.Response != nil || rc.Variants != nil || rc.Paginated
	switch {
	case rc.File && (data || rc.NoData):
		return true, fmt.Errorf("%s registers a file and a JSON response", route.Key())
	case rc.NoData && data:
		return true, fmt.Errorf("%s registers a response and no data", route.Key())
	}
	route.NoData = rc.NoData
	return rc.File || rc.NoData, nil
}

func (b *builder) responses(route *Route, rc Registration, options Options) error {
	where := route.Key()
	if handled, err := withoutData(route, rc); handled {
		return err
	}
	if rc.Variants == nil {
		if rc.Response == nil {
			return fmt.Errorf("%s registers no response", where)
		}
		s, err := b.top(rc.Response, where, false)
		route.Response = &s
		return err
	}
	if rc.Response != nil {
		return fmt.Errorf("%s registers a response and variants", where)
	}
	if !slices.Contains(options.QueryVariants, where) {
		return fmt.Errorf("%s: the response shape depends on ?%s. Give a new route a discriminator field or its own path (ADR 0270)", where, rc.Variants.QueryParam)
	}
	b.used["variants:"+where] = true
	if _, ok := rc.Variants.ByValue[rc.Variants.Default]; !ok {
		return fmt.Errorf("%s: default variant %q is not registered", where, rc.Variants.Default)
	}
	route.Variants = &Variants{QueryParam: rc.Variants.QueryParam, Default: rc.Variants.Default, Cases: map[string]Schema{}}
	for value, zero := range rc.Variants.ByValue {
		s, err := b.top(zero, where, false)
		if err != nil {
			return err
		}
		route.Variants.Cases[value] = s
	}
	return nil
}

func (b *builder) unused(options Options) error {
	registers := map[string][]string{
		"variants:": options.QueryVariants,
		"enum:":     sortedKeys(b.enumByField), "deprecated:": sortedKeys(b.deprecated),
	}
	for t := range options.Readers {
		registers["reader:"] = append(registers["reader:"], t.String())
	}
	for _, t := range options.Dates {
		registers["date:"] = append(registers["date:"], t.String())
	}
	for _, t := range options.Instants {
		registers["instant:"] = append(registers["instant:"], t.String())
	}
	labels := map[string]string{"date:": "day type ", "instant:": "instant type ", "variants:": "query variant ", "enum:": "enum field ", "deprecated:": "deprecated field ", "reader:": "reader "}
	var stale []string
	for prefix, keys := range registers {
		for _, key := range keys {
			if !b.used[prefix+key] {
				stale = append(stale, labels[prefix]+key)
			}
		}
	}
	if len(stale) == 0 {
		return nil
	}
	sort.Strings(stale)
	return fmt.Errorf("contract registers name nothing that is registered; remove them:\n%s", strings.Join(stale, "\n"))
}

// top is the envelope's data member or a bound body. A registered list is
// rendered from a non-nil slice; a handler that passes a nil slice sends
// null, which the decoder rejects instead of reading an empty list.
func (b *builder) top(zero any, where string, request bool) (Schema, error) {
	t := reflect.TypeOf(zero)
	s, err := b.schema(t, where, request)
	// A registered pointer says the route may answer null: there is no such
	// object now.
	s.Nullable = !request && t != nil && t.Kind() == reflect.Pointer
	return s, err
}

func (b *builder) schema(t reflect.Type, where string, request bool) (Schema, error) {
	if t.Kind() == reflect.Pointer {
		s, err := b.schema(t.Elem(), where, request)
		s.Nullable = true
		return s, err
	}
	if s, known, err := b.named(t, where, request); known || err != nil {
		return s, err
	}
	switch t.Kind() {
	case reflect.String:
		return Schema{Kind: KindString}, nil
	case reflect.Bool:
		return Schema{Kind: KindBool}, nil
	case reflect.Int64, reflect.Uint64:
		// The field decides: see numericID.
		return Schema{Kind: KindInt}, errBareInt64
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32:
		return Schema{Kind: KindInt}, nil
	case reflect.Float32, reflect.Float64:
		return Schema{Kind: KindNumber}, nil
	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 {
			if t.Kind() == reflect.Array {
				return Schema{}, fmt.Errorf("%s: a byte array is not supported", where)
			}
			// encoding/json writes []byte as a base64 string, nil as null.
			return Schema{Kind: KindString, Nullable: true}, nil
		}
		elem, err := b.schema(t.Elem(), where, request)
		// A nil slice renders as null.
		return Schema{Kind: KindArray, Elem: &elem, Nullable: t.Kind() == reflect.Slice}, err
	case reflect.Map:
		// encoding/json writes an integer key as its decimal string.
		switch t.Key().Kind() {
		case reflect.String, reflect.Int, reflect.Int32, reflect.Int64:
		default:
			return Schema{}, fmt.Errorf("%s: map key %s is not a string", where, t.Key())
		}
		elem, err := b.schema(t.Elem(), where, request)
		return Schema{Kind: KindMap, Elem: &elem, Nullable: true}, err
	case reflect.Interface:
		// An empty interface holds whatever JSON was stored or sent; a nil
		// one renders as null.
		if t.NumMethod() == 0 {
			return Schema{Kind: KindJSON, Nullable: true}, nil
		}
	case reflect.Struct:
		name, err := b.object(t, where, request)
		return Schema{Kind: KindRef, Ref: name}, err
	}
	return Schema{}, fmt.Errorf("%s: unsupported type %s", where, t)
}

// timeSchema is the schema of an instant or day type: time.Time,
// calendar.Date and the types the root names beside them.
func (b *builder) timeSchema(t reflect.Type) (Schema, bool) {
	if b.instants[t] {
		if t != timeType {
			b.used["instant:"+t.String()] = true
		}
		return Schema{Kind: KindInstant}, true
	}
	if b.dates[t] {
		// A day type renders its zero value as null.
		if t != dateType {
			b.used["date:"+t.String()] = true
		}
		return Schema{Kind: KindDate, Nullable: true}, true
	}
	return Schema{}, false
}

// named decides the types whose Go type, not their kind, says what travels:
// instants, days, identifiers and enums. It also stops at a type that writes
// or reads itself without an entry.
func (b *builder) named(t reflect.Type, where string, request bool) (Schema, bool, error) {
	if t == rawJSONType {
		// A raw value is any JSON the owner stores and hands on; nil is null
		// or, with omitempty, no key.
		return Schema{Kind: KindJSON, Nullable: true}, true, nil
	}
	if schema, ok := b.timeSchema(t); ok {
		return schema, true, nil
	}
	if kind, ok := b.identifiers[t]; ok {
		return Schema{Kind: kind}, true, nil
	}
	if name, ok := b.enumByType[t]; ok {
		return Schema{Kind: KindEnum, Ref: name}, true, nil
	}
	if request && b.readers[t] == ReadsValue {
		b.used["reader:"+t.String()] = true
		s, err := b.wrapped(t, where)
		return s, true, err
	}
	if t.Implements(marshalerType) || reflect.PointerTo(t).Implements(marshalerType) {
		return Schema{}, false, fmt.Errorf("%s: %s has its own MarshalJSON and no entry in the contract generator", where, t)
	}
	if request && reflect.PointerTo(t).Implements(unmarshalerType) {
		// Reflection describes the fields, the type's own reader decides what
		// it takes; only an entry can say how the two agree.
		if _, known := b.readers[t]; !known {
			return Schema{}, false, fmt.Errorf("%s: %s has its own UnmarshalJSON and no entry in the contract generator", where, t)
		}
		b.used["reader:"+t.String()] = true
	}
	return Schema{}, false, nil
}

// wrapped is the request value a ReadsValue wrapper reads into its field
// Value. The wrapper itself tells an absent key from null.
func (b *builder) wrapped(t reflect.Type, where string) (Schema, error) {
	sf, ok := t.FieldByName("Value")
	if !ok || t.Kind() != reflect.Struct {
		return Schema{}, fmt.Errorf("%s: %s reads a value but has no field Value", where, t)
	}
	at := where + "." + t.Name() + ".Value"
	s, err := b.schema(sf.Type, at, true)
	if errors.Is(err, errBareInt64) {
		err = b.numericID(&s, t, at)
	}
	return s, err
}

func (b *builder) object(t reflect.Type, where string, request bool) (string, error) {
	// An instance of a generic type is named for the type: the owner of a
	// route declares it, the root names the rows it carries (#7563). Two
	// instances of one type collide below like any two types of one name.
	name, _, _ := strings.Cut(t.Name(), "[")
	if name == "" {
		return "", fmt.Errorf("%s: anonymous struct is not supported", where)
	}
	if known, ok := b.names[t]; ok {
		if b.requestTypes[known] != request {
			return "", fmt.Errorf("%s: %s is used as a request and as a response", where, t)
		}
		return known, nil
	}
	if existing, taken := b.types[name]; taken && existing.GoType != t.String() {
		return "", fmt.Errorf("%s: type name %s is used by %s and %s", where, name, existing.GoType, t)
	}
	b.names[t] = name
	b.requestTypes[name] = request
	// Reserved before the walk so that a recursive type terminates.
	b.types[name] = Object{Name: name, GoType: t.String(), Request: request}
	fields, err := b.fields(t, where+" "+name, request)
	if err != nil {
		return "", err
	}
	b.types[name] = Object{Name: name, GoType: t.String(), Request: request, Fields: fields}
	return name, nil
}
