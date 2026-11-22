package contract

import (
	"errors"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"strings"
)

var errBareInt64 = errors.New("bare int64")

type candidate struct {
	field  Field
	depth  int
	tagged bool
	order  int
}

// collector gathers the fields of one object across its embedded structs.
type collector struct {
	b       *builder
	root    reflect.Type
	where   string
	request bool
	byName  map[string][]candidate
	order   int
}

// fields applies encoding/json's rules for embedded structs: the shallowest
// field of a name wins, among equals the tagged one, otherwise none.
func (b *builder) fields(root reflect.Type, where string, request bool) ([]Field, error) {
	c := &collector{b: b, root: root, where: where, request: request, byName: map[string][]candidate{}}
	if err := c.walk(root, 0); err != nil {
		return nil, err
	}
	var chosen []candidate
	for _, candidates := range c.byName {
		if best, ok := dominant(candidates); ok {
			chosen = append(chosen, best)
		}
	}
	sort.Slice(chosen, func(i, j int) bool { return chosen[i].order < chosen[j].order })
	fields := make([]Field, len(chosen))
	for i, candidate := range chosen {
		fields[i] = candidate.field
	}
	return fields, nil
}

func dominant(candidates []candidate) (candidate, bool) {
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].depth != candidates[j].depth {
			return candidates[i].depth < candidates[j].depth
		}
		return candidates[i].tagged && !candidates[j].tagged
	})
	best := candidates[0]
	tie := len(candidates) > 1 && candidates[1].depth == best.depth && candidates[1].tagged == best.tagged
	return best, !tie
}

func (c *collector) walk(t reflect.Type, depth int) error {
	for i := range t.NumField() {
		sf := t.Field(i)
		tag, hasTag := sf.Tag.Lookup("json")
		name, options, _ := strings.Cut(tag, ",")
		if name == "-" && options == "" {
			continue
		}
		if inner, ok := embeddedStruct(sf, name); ok {
			if err := c.walk(inner, depth+1); err != nil {
				return err
			}
			continue
		}
		if !sf.IsExported() {
			continue
		}
		if err := c.add(t, sf, name, strings.Split(options, ","), depth, hasTag && tag != ""); err != nil {
			return err
		}
	}
	return nil
}

func (c *collector) add(declaring reflect.Type, sf reflect.StructField, name string, options []string, depth int, tagged bool) error {
	if name == "" {
		name = sf.Name
	}
	field, err := c.b.field(declaring, c.root, sf, name, options, c.where, c.request)
	if err != nil {
		return err
	}
	c.order++
	c.byName[name] = append(c.byName[name], candidate{field: field, depth: depth, tagged: tagged, order: c.order})
	return nil
}

// embeddedStruct reports an untagged embedded struct, whose fields render as
// fields of the outer object.
func embeddedStruct(sf reflect.StructField, name string) (reflect.Type, bool) {
	inner := sf.Type
	if inner.Kind() == reflect.Pointer {
		inner = inner.Elem()
	}
	return inner, sf.Anonymous && name == "" && inner.Kind() == reflect.Struct && inner != timeType
}

// field describes one struct field. declaring is the struct that declares
// it, root the object it renders in; they differ for an embedded struct.
func (b *builder) field(declaring, root reflect.Type, sf reflect.StructField, name string, options []string, where string, request bool) (Field, error) {
	at := where + "." + sf.Name
	schema, err := b.schema(sf.Type, at, request)
	format := sf.Tag.Get("contract")
	switch {
	case slices.Contains(options, "string"):
		// ,string makes encoding/json read only a string, and it does not
		// reach a list; ident.ID is the one identifier type (ADR 0300).
		err = fmt.Errorf("%s: the json option ,string does not make an identifier. Use ident.ID (ADR 0300)", at)
	case errors.Is(err, errBareInt64) && format == "number":
		// A running number or a count kept as int64: a number, never an
		// identifier.
		err, format = nil, ""
	case errors.Is(err, errBareInt64):
		err = bareInt64(at)
	}
	if err == nil && namesIdentifier(name) && readsNumber(schema) {
		// The name does not make an identifier, but a number under an
		// identifier's name is one the type forgot (ADR 0300).
		err = fmt.Errorf("%s: %q names an identifier but is a number. Use ident.ID", at, name)
	}
	if err == nil {
		err = setFormat(&schema, format, at)
	}
	if err != nil {
		return Field{}, err
	}
	field := Field{Name: name, Schema: schema}
	owners := []reflect.Type{declaring}
	if root != declaring {
		owners = append(owners, root)
	}
	for _, owner := range owners {
		if err := b.mark(&field, owner.Name()+"."+name); err != nil {
			return Field{}, fmt.Errorf("%s: %w", at, err)
		}
	}
	if request {
		// Go reads an absent key as the zero value; what is required is the
		// handler's rule and reaches the client through the error contract.
		field.Optional = true
		return field, nil
	}
	b.omission(&field, sf.Type, options)
	return field, nil
}

// mark applies what the owner registered for "GoType.json_name".
func (b *builder) mark(field *Field, key string) error {
	if enum, ok := b.enumByField[key]; ok {
		if err := setEnum(&field.Schema, enum); err != nil {
			return err
		}
		b.used["enum:"+key] = true
	}
	if b.deprecated[key] {
		field.Deprecated = true
		b.used["deprecated:"+key] = true
	}
	return nil
}

// omission applies omitempty and omitzero: when the key is absent, and that
// an omitted nil is never null.
func (b *builder) omission(field *Field, t reflect.Type, options []string) {
	nilable := t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice || t.Kind() == reflect.Map || t.Kind() == reflect.Interface
	if slices.Contains(options, "omitempty") {
		switch {
		case nilable:
			field.Optional, field.Schema.Nullable = true, false
		case t.Kind() == reflect.Struct || t.Kind() == reflect.Array:
			// encoding/json never omits a struct value.
		default:
			field.Optional = true
			if b.dates[t] {
				field.Schema.Nullable = false
			}
		}
	}
	if slices.Contains(options, "omitzero") {
		field.Optional = true
		if t.Kind() == reflect.Pointer || b.dates[t] {
			field.Schema.Nullable = false
		}
	}
	if field.Schema.Kind == KindJSON {
		// Present JSON may itself be null.
		field.Schema.Nullable = true
	}
}

// bareInt64 refuses an int64 that does not say what it is: an identifier is
// an ident.ID, a count or an amount an int or an int64 tagged
// contract:"number" (ADR 0270, ADR 0300).
func bareInt64(at string) error {
	return fmt.Errorf("%s: int64 does not say what it is. Use ident.ID for an identifier, and int or contract:\"number\" for a count or an amount (ADR 0270)", at)
}

// namesIdentifier tells whether a JSON key is the name of an identifier.
func namesIdentifier(name string) bool {
	return name == "id" || strings.HasSuffix(name, "_id") || strings.HasSuffix(name, "_ids")
}

// readsNumber tells whether a value, or an element of it, is a plain number.
func readsNumber(schema Schema) bool {
	for (schema.Kind == KindArray || schema.Kind == KindMap) && schema.Elem != nil {
		schema = *schema.Elem
	}
	return schema.Kind == KindInt || schema.Kind == KindNumber
}

// formats are the string forms a field names in its `contract` tag. A value
// with its own Go type (calendar.Date, time.Time) needs no tag.
var formats = map[string]string{"date": KindDate, "clock": KindClock}

// setFormat applies `contract:"date"` or `contract:"clock"` to a string
// field whose Go type does not say which form the string has.
func setFormat(schema *Schema, format, at string) error {
	if format == "" {
		return nil
	}
	leaf := schema
	for leaf.Kind == KindArray {
		leaf = leaf.Elem
	}
	kind, known := formats[format]
	if !known || leaf.Kind != KindString {
		return fmt.Errorf("%s: the tag contract:%q needs a string field and one of date, clock", at, format)
	}
	leaf.Kind = kind
	return nil
}

func setEnum(schema *Schema, enum string) error {
	leaf := schema
	for leaf.Kind == KindArray {
		leaf = leaf.Elem
	}
	if leaf.Kind != KindString {
		return fmt.Errorf("an enum needs a string field, found %s", leaf.Kind)
	}
	leaf.Kind, leaf.Ref = KindEnum, enum
	return nil
}
