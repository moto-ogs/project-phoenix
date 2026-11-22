package contractmodel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Answer is one response as a handler wrote it.
type Answer struct {
	Status int
	Body   []byte
	// Variant is the value of the route's variant query parameter; empty
	// selects the default.
	Variant string
}

var (
	int64Text = regexp.MustCompile(`^(0|-?[1-9]\d{0,18})$`)
	clockText = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
)

// maxSafeInteger is the largest integer a JSON number carries through
// JSON.parse without rounding.
const maxSafeInteger = 1<<53 - 1

// Violations lists where a successful answer leaves the contract of its
// route. It decides as the generated decoders do (typescript.go and the
// frontend's runtime.ts): a key the contract does not name is ignored, an
// absent key needs an optional field and a null a nullable one. The BFF
// answers 502 for every body this function reports.
func (d Document) Violations(route Route, answer Answer) []string {
	c := &checker{types: map[string]Object{}}
	for _, object := range d.Types {
		c.types[object.Name] = object
	}
	if route.File {
		return []string{"the route registers a file, not the envelope"}
	}
	body := bytes.TrimSpace(answer.Body)
	if route.NoData && len(body) == 0 {
		return nil
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil {
		return []string{"the body is not a JSON object: " + err.Error()}
	}
	if string(envelope["status"]) != `"success"` {
		c.failf("status", `want "success", found %s`, shown(envelope["status"]))
	}
	data, present := envelope["data"]
	switch {
	case route.NoData:
		if present && string(data) != "null" {
			c.failf("data", "the route registers no data, found %s", shown(data))
		}
	case !present:
		c.failf("data", "the key is absent")
	default:
		c.value("data", c.responseSchema(route, answer.Variant), data)
	}
	if route.Paginated {
		c.pagination(envelope["pagination"])
	}
	return c.found
}

type checker struct {
	types map[string]Object
	found []string
}

func (c *checker) failf(at, format string, args ...any) {
	c.found = append(c.found, at+": "+fmt.Sprintf(format, args...))
}

func (c *checker) responseSchema(route Route, variant string) Schema {
	if route.Variants == nil {
		return *route.Response
	}
	if s, ok := route.Variants.Cases[variant]; ok {
		return s
	}
	return route.Variants.Cases[route.Variants.Default]
}

func (c *checker) pagination(raw json.RawMessage) {
	var page map[string]json.RawMessage
	if err := json.Unmarshal(raw, &page); err != nil || page == nil {
		c.failf("pagination", "want an object, found %s", shown(raw))
		return
	}
	for _, key := range []string{"current_page", "page_size", "total_pages", "total_records"} {
		c.value("pagination."+key, Schema{Kind: KindInt}, page[key])
	}
}

func (c *checker) value(at string, s Schema, raw json.RawMessage) {
	if string(raw) == "null" {
		if !s.Nullable {
			c.failf(at, "null where the contract names no null")
		}
		return
	}
	switch s.Kind {
	case KindArray:
		var items []json.RawMessage
		if err := json.Unmarshal(raw, &items); err != nil {
			c.failf(at, "want an array, found %s", shown(raw))
			return
		}
		for i, item := range items {
			c.value(fmt.Sprintf("%s[%d]", at, i), *s.Elem, item)
		}
	case KindMap:
		var members map[string]json.RawMessage
		if err := json.Unmarshal(raw, &members); err != nil {
			c.failf(at, "want an object, found %s", shown(raw))
			return
		}
		for key, member := range members {
			c.value(at+"."+key, *s.Elem, member)
		}
	case KindRef:
		c.object(at, s.Ref, raw)
	case KindJSON:
		// Any JSON value keeps the contract.
	default:
		if reason := scalar(s.Kind, raw); reason != "" {
			c.failf(at, "want %s, found %s", reason, shown(raw))
		}
	}
}

func (c *checker) object(at, name string, raw json.RawMessage) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil || members == nil {
		c.failf(at, "want the object %s, found %s", name, shown(raw))
		return
	}
	for _, field := range c.types[name].Fields {
		member, present := members[field.Name]
		if !present {
			if !field.Optional {
				c.failf(at+"."+field.Name, "the key is absent and the field is not optional")
			}
			continue
		}
		c.value(at+"."+field.Name, field.Schema, member)
	}
}

// scalar returns what the kind wants when raw is something else.
func scalar(kind string, raw json.RawMessage) string {
	text, isString := "", false
	if len(raw) > 0 && raw[0] == '"' {
		isString = json.Unmarshal(raw, &text) == nil
	}
	ok := false
	want := map[string]string{
		KindString: "a string", KindEnum: "a string", KindBool: "a boolean",
		KindInt: "a safe integer", KindNumber: "a number",
		KindID:   "an identifier as a decimal string",
		KindDate: "a day as YYYY-MM-DD", KindInstant: "an RFC 3339 instant", KindClock: "a time as HH:MM",
	}[kind]
	switch kind {
	case KindString, KindEnum:
		ok = isString
	case KindBool:
		ok = string(raw) == "true" || string(raw) == "false"
	case KindInt:
		ok = safeInteger(raw)
	case KindNumber:
		var number float64
		ok = !isString && json.Unmarshal(raw, &number) == nil
	case KindID:
		ok = isString && int64Text.MatchString(text)
	case KindDate:
		_, err := time.Parse(time.DateOnly, text)
		ok = isString && err == nil
	case KindInstant:
		_, err := time.Parse(time.RFC3339Nano, text)
		ok = isString && err == nil
	case KindClock:
		ok = isString && clockText.MatchString(text)
	default:
		want = "a known kind, not " + kind
	}
	if ok {
		return ""
	}
	return want
}

func safeInteger(raw json.RawMessage) bool {
	var number json.Number
	if len(raw) == 0 || raw[0] == '"' || json.Unmarshal(raw, &number) != nil {
		return false
	}
	integer, err := number.Int64()
	return err == nil && integer <= maxSafeInteger && integer >= -maxSafeInteger
}

func shown(raw json.RawMessage) string {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return "nothing"
	}
	if len(text) > 80 {
		return text[:80] + "…"
	}
	return text
}
