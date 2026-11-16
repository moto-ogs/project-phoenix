package contractspike

import (
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Kinds of the intermediate model both generators read.
const (
	KindString   = "string"
	KindBool     = "bool"
	KindInt      = "int"       // JSON number, safe integer
	KindNumber   = "number"    // JSON number
	KindID       = "id"        // identifier as a JSON string
	KindLegacyID = "legacy_id" // identifier as a JSON number (existing routes)
	KindLaxID    = "lax_id"    // request identifier: number or string (common.JSONID)
	KindDate     = "date"      // YYYY-MM-DD
	KindInstant  = "instant"   // RFC 3339
	KindArray    = "array"
	KindMap      = "map"
	KindRef      = "ref"
)

// Schema is one value on the wire.
type Schema struct {
	Kind     string  `json:"kind"`
	Nullable bool    `json:"nullable,omitempty"`
	Elem     *Schema `json:"elem,omitempty"`
	Ref      string  `json:"ref,omitempty"`
}

// Field is one member of an object. Optional means the key may be absent.
type Field struct {
	Name     string `json:"name"`
	Optional bool   `json:"optional,omitempty"`
	Schema   Schema `json:"schema"`
}

type Object struct {
	Name   string  `json:"name"`
	GoType string  `json:"go_type"`
	Fields []Field `json:"fields"`
}

type Variants struct {
	QueryParam string            `json:"query_param"`
	Default    string            `json:"default"`
	Cases      map[string]Schema `json:"cases"`
}

type Route struct {
	Method    string    `json:"method"`
	Pattern   string    `json:"pattern"`
	Portals   []string  `json:"portals"`
	Paginated bool      `json:"paginated,omitempty"`
	Request   *Schema   `json:"request,omitempty"`
	Response  *Schema   `json:"response,omitempty"`
	Variants  *Variants `json:"variants,omitempty"`
}

// Document is the whole contract: the committed artifact a base-branch
// comparison would read.
type Document struct {
	Routes []Route  `json:"routes"`
	Probes []string `json:"probes,omitempty"`
	Types  []Object `json:"types"`
}

var (
	marshalerType = reflect.TypeFor[json.Marshaler]()
	timeType      = reflect.TypeFor[time.Time]()
	dateType      = reflect.TypeFor[calendar.Date]()
	jsonIDType    = reflect.TypeFor[common.JSONID]()
	idName        = regexp.MustCompile(`(^|_)ids?$|_by$`)
)

type builder struct {
	types map[string]Object
	names map[reflect.Type]string
}

// Build walks the registrations with reflection, following encoding/json.
func Build(routes []RouteContract, probes []any) (Document, error) {
	b := &builder{types: map[string]Object{}, names: map[reflect.Type]string{}}
	doc := Document{}
	for _, rc := range routes {
		route := Route{Method: rc.Method, Pattern: rc.Pattern, Paginated: rc.Paginated}
		for _, portal := range rc.Portals {
			route.Portals = append(route.Portals, string(portal))
		}
		where := rc.Method + " " + rc.Pattern
		if rc.Request != nil {
			s, err := b.top(rc.Request, where)
			if err != nil {
				return doc, err
			}
			route.Request = &s
		}
		if rc.Variants != nil {
			route.Variants = &Variants{QueryParam: rc.Variants.QueryParam, Default: rc.Variants.Default, Cases: map[string]Schema{}}
			for value, zero := range rc.Variants.ByValue {
				s, err := b.top(zero, where)
				if err != nil {
					return doc, err
				}
				route.Variants.Cases[value] = s
			}
		} else {
			s, err := b.top(rc.Response, where)
			if err != nil {
				return doc, err
			}
			route.Response = &s
		}
		doc.Routes = append(doc.Routes, route)
	}
	for _, probe := range probes {
		s, err := b.top(probe, "probe")
		if err != nil {
			return doc, err
		}
		doc.Probes = append(doc.Probes, s.Ref)
	}
	for _, object := range b.types {
		doc.Types = append(doc.Types, object)
	}
	sort.Slice(doc.Types, func(i, j int) bool { return doc.Types[i].Name < doc.Types[j].Name })
	sort.Slice(doc.Routes, func(i, j int) bool {
		return doc.Routes[i].Method+" "+doc.Routes[i].Pattern < doc.Routes[j].Method+" "+doc.Routes[j].Pattern
	})
	return doc, nil
}

// top is the data member of the envelope. A registered list is rendered from
// a non-nil slice, so it is not nullable (assumption of the spike; a handler
// that passes a nil slice sends null).
func (b *builder) top(zero any, where string) (Schema, error) {
	s, err := b.schema(reflect.TypeOf(zero), where, "")
	s.Nullable = false
	return s, err
}

func (b *builder) schema(t reflect.Type, where, fieldName string) (Schema, error) {
	if t.Kind() == reflect.Pointer {
		s, err := b.schema(t.Elem(), where, fieldName)
		s.Nullable = true
		return s, err
	}
	switch t {
	case timeType:
		return Schema{Kind: KindInstant}, nil
	case dateType:
		// calendar.Date renders its zero value as null.
		return Schema{Kind: KindDate, Nullable: true}, nil
	case jsonIDType:
		return Schema{Kind: KindLaxID}, nil
	}
	if t.Implements(marshalerType) || reflect.PointerTo(t).Implements(marshalerType) {
		return Schema{}, fmt.Errorf("%s: %s has its own MarshalJSON and no entry in the generator's table", where, t)
	}
	switch t.Kind() {
	case reflect.String:
		return Schema{Kind: KindString}, nil
	case reflect.Bool:
		return Schema{Kind: KindBool}, nil
	case reflect.Int64, reflect.Uint64:
		if idName.MatchString(fieldName) {
			return Schema{Kind: KindLegacyID}, nil
		}
		return Schema{Kind: KindInt}, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32:
		return Schema{Kind: KindInt}, nil
	case reflect.Float32, reflect.Float64:
		return Schema{Kind: KindNumber}, nil
	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 {
			return Schema{}, fmt.Errorf("%s: []byte is not supported", where)
		}
		elem, err := b.schema(t.Elem(), where, fieldName)
		// A nil slice renders as null.
		return Schema{Kind: KindArray, Elem: &elem, Nullable: t.Kind() == reflect.Slice}, err
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return Schema{}, fmt.Errorf("%s: map key %s is not a string", where, t.Key())
		}
		elem, err := b.schema(t.Elem(), where, "")
		return Schema{Kind: KindMap, Elem: &elem, Nullable: true}, err
	case reflect.Struct:
		name, err := b.object(t, where)
		return Schema{Kind: KindRef, Ref: name}, err
	}
	return Schema{}, fmt.Errorf("%s: unsupported type %s", where, t)
}

func (b *builder) object(t reflect.Type, where string) (string, error) {
	if name, ok := b.names[t]; ok {
		return name, nil
	}
	name := t.Name()
	if name == "" {
		return "", fmt.Errorf("%s: anonymous struct is not supported", where)
	}
	if existing, taken := b.types[name]; taken && existing.GoType != t.String() {
		return "", fmt.Errorf("%s: type name %s is used by %s and %s", where, name, existing.GoType, t)
	}
	b.names[t] = name
	b.types[name] = Object{}
	fields, err := b.fields(t, where+" "+name)
	if err != nil {
		return "", err
	}
	b.types[name] = Object{Name: name, GoType: t.String(), Fields: fields}
	return name, nil
}

type candidate struct {
	field  Field
	depth  int
	tagged bool
	order  int
}

// fields applies encoding/json's rules for embedded structs: the shallowest
// field of a name wins, among equals the tagged one, otherwise none.
func (b *builder) fields(t reflect.Type, where string) ([]Field, error) {
	byName := map[string][]candidate{}
	order := 0
	var walk func(t reflect.Type, depth int) error
	walk = func(t reflect.Type, depth int) error {
		for i := range t.NumField() {
			sf := t.Field(i)
			tag, hasTag := sf.Tag.Lookup("json")
			name, options, _ := strings.Cut(tag, ",")
			if name == "-" && options == "" {
				continue
			}
			inner := sf.Type
			if inner.Kind() == reflect.Pointer {
				inner = inner.Elem()
			}
			if sf.Anonymous && name == "" && inner.Kind() == reflect.Struct && inner != timeType {
				if err := walk(inner, depth+1); err != nil {
					return err
				}
				continue
			}
			if !sf.IsExported() {
				continue
			}
			if name == "" {
				name = sf.Name
			}
			field, err := b.field(sf, name, options, where)
			if err != nil {
				return err
			}
			order++
			byName[name] = append(byName[name], candidate{field: field, depth: depth, tagged: hasTag && tag != "", order: order})
		}
		return nil
	}
	if err := walk(t, 0); err != nil {
		return nil, err
	}
	var chosen []candidate
	for _, candidates := range byName {
		sort.Slice(candidates, func(i, j int) bool {
			if candidates[i].depth != candidates[j].depth {
				return candidates[i].depth < candidates[j].depth
			}
			return candidates[i].tagged && !candidates[j].tagged
		})
		best := candidates[0]
		if len(candidates) > 1 && candidates[1].depth == best.depth && candidates[1].tagged == best.tagged {
			continue
		}
		chosen = append(chosen, best)
	}
	sort.Slice(chosen, func(i, j int) bool { return chosen[i].order < chosen[j].order })
	fields := make([]Field, len(chosen))
	for i, c := range chosen {
		fields[i] = c.field
	}
	return fields, nil
}

func (b *builder) field(sf reflect.StructField, name, options, where string) (Field, error) {
	schema, err := b.schema(sf.Type, where+"."+sf.Name, name)
	if err != nil {
		return Field{}, err
	}
	field := Field{Name: name, Schema: schema}
	opts := strings.Split(options, ",")
	has := func(option string) bool {
		for _, o := range opts {
			if o == option {
				return true
			}
		}
		return false
	}
	if has("string") {
		switch field.Schema.Kind {
		case KindLegacyID, KindInt:
			field.Schema.Kind = KindID
		default:
			return Field{}, fmt.Errorf("%s.%s: ,string on %s is not supported", where, sf.Name, sf.Type)
		}
	}
	if has("omitempty") {
		switch sf.Type.Kind() {
		case reflect.Pointer, reflect.Slice, reflect.Map, reflect.Interface:
			// nil is left out, so the key is absent and never null.
			field.Optional, field.Schema.Nullable = true, false
		case reflect.Struct, reflect.Array:
			// encoding/json never omits a struct value.
		default:
			field.Optional = true
			if sf.Type == dateType {
				field.Schema.Nullable = false
			}
		}
	}
	if has("omitzero") {
		field.Optional = true
		if sf.Type.Kind() == reflect.Pointer || sf.Type == dateType {
			field.Schema.Nullable = false
		}
	}
	return field, nil
}
