package contractmodel

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func checkedDocument() (Document, Route) {
	array := func(elem Schema, nullable bool) Schema {
		return Schema{Kind: KindArray, Elem: &elem, Nullable: nullable}
	}
	doc := Document{Types: []Object{
		{Name: "Row", GoType: "rows.Row", Fields: []Field{
			{Name: "id", Schema: Schema{Kind: KindID}},
			{Name: "count", Schema: Schema{Kind: KindInt}},
			{Name: "day", Schema: Schema{Kind: KindDate, Nullable: true}},
			{Name: "at", Schema: Schema{Kind: KindInstant}},
			{Name: "pickup", Optional: true, Schema: Schema{Kind: KindClock}},
			{Name: "tags", Schema: array(Schema{Kind: KindString}, true)},
			{Name: "children", Optional: true, Schema: array(Schema{Kind: KindRef, Ref: "Row"}, false)},
			{Name: "by_day", Schema: Schema{Kind: KindMap, Elem: &Schema{Kind: KindBool}, Nullable: true}},
			{Name: "old", Optional: true, Schema: Schema{Kind: KindJSON, Nullable: true}},
		}},
	}}
	response := array(Schema{Kind: KindRef, Ref: "Row"}, false)
	return doc, Route{Method: "GET", Pattern: "/api/rows/", Response: &response}
}

const checkedRow = `{"id":"7","count":2,"day":"2026-09-09","at":"2026-09-09T12:00:00+02:00","pickup":"15:30","tags":["a"],"children":[],"by_day":{"mon":true},"old":{"is_absent":true},"extra":1}`

func TestViolationsAcceptsWhatTheDecoderReads(t *testing.T) {
	t.Parallel()
	doc, route := checkedDocument()
	for name, body := range map[string]string{
		"a filled row with a key the contract does not name": `{"status":"success","data":[` + checkedRow + `],"message":"ok"}`,
		"an empty list": `{"status":"success","data":[]}`,
		"null where nullable, absent where optional": `{"status":"success","data":[{"id":"7","count":0,"day":null,"at":"2026-09-09T10:00:00.123456789Z","tags":null,"by_day":null}]}`,
		"a raw value of any shape":                   `{"status":"success","data":[{"id":"7","count":0,"day":null,"at":"2026-09-09T10:00:00Z","tags":[],"by_day":{},"old":"text"}]}`,
		"an identifier beyond 2^53 as a string":      `{"status":"success","data":[{"id":"9007199254740993","count":0,"day":null,"at":"2026-09-09T10:00:00Z","tags":[],"by_day":{}}]}`,
	} {
		assert.Emptyf(t, doc.Violations(route, Answer{Status: 200, Body: []byte(body)}), name)
	}
}

func TestViolationsNamesWhatTheDecoderRefuses(t *testing.T) {
	t.Parallel()
	doc, route := checkedDocument()
	row := func(change string) string {
		return `{"status":"success","data":[{"id":"7","count":2,"day":null,"at":"2026-09-09T10:00:00Z","tags":[],"by_day":{}` + change + `}]}`
	}
	for body, want := range map[string]string{
		`[]`:                               "the body is not a JSON object",
		`{"status":"error","data":[]}`:     `status: want "success"`,
		`{"status":"success"}`:             "data: the key is absent",
		`{"status":"success","data":null}`: "data: null where the contract names no null",
		`{"status":"success","data":{}}`:   "data: want an array",
		row(`,"id":7`):                     "data[0].id: want an identifier as a decimal string",
		row(`,"id":9007199254740993`):      "data[0].id: want an identifier as a decimal string",
		row(`,"count":1.5`):                "data[0].count: want a safe integer",
		row(`,"day":""`):                   "data[0].day: want a day as YYYY-MM-DD",
		row(`,"day":"2026-02-30"`):         "data[0].day: want a day as YYYY-MM-DD",
		row(`,"at":"2026-09-09 10:00:00"`): "data[0].at: want an RFC 3339 instant",
		row(`,"pickup":"7:45"`):            "data[0].pickup: want a time as HH:MM",
		row(`,"pickup":null`):              "data[0].pickup: null where the contract names no null",
		row(`,"children":null`):            "data[0].children: null where the contract names no null",
		row(`,"children":[{}]`):            "data[0].children[0].id: the key is absent and the field is not optional",
		row(`,"by_day":{"mon":"yes"}`):     "data[0].by_day.mon: want a boolean",
		row(`,"tags":[1]`):                 "data[0].tags[0]: want a string",
	} {
		violations := doc.Violations(route, Answer{Status: 200, Body: []byte(body)})
		if assert.NotEmptyf(t, violations, "%s passes", body) {
			assert.Containsf(t, violations[0], want, "%s", body)
		}
	}
}

func TestViolationsKnowsEveryEnvelope(t *testing.T) {
	t.Parallel()
	doc, route := checkedDocument()
	validator := doc.AnswerValidator()

	noData := Route{Method: "DELETE", Pattern: "/api/rows/{id}", NoData: true}
	assert.Empty(t, validator.Violations(noData, Answer{Status: 204}))
	assert.NotEmpty(t, validator.Violations(noData, Answer{Status: 200}), "an empty 200 is not a JSON envelope")
	assert.Empty(t, validator.Violations(noData, Answer{Status: 200, Body: []byte(`{"status":"success","message":"ok"}`)}))
	assert.Empty(t, validator.Violations(noData, Answer{Status: 200, Body: []byte(`{"status":"success","data":null}`)}))
	assert.NotEmpty(t, validator.Violations(noData, Answer{Status: 200, Body: []byte(`{"status":"success","data":{}}`)}))
	assert.NotEmpty(t, validator.Violations(route, Answer{Status: 204}), "a route with data may not answer 204")
	file := Route{Method: "GET", Pattern: "/api/rows/export", File: true}
	assert.Equal(t, []string{"the route registers a file, not the envelope"},
		validator.Violations(file, Answer{Status: 200, Body: []byte(`{"status":"success","data":[]}`)}), "a file route never answers the envelope")

	paginated := route
	paginated.Paginated = true
	page := `"pagination":{"current_page":1,"page_size":50,"total_pages":0,"total_records":0}`
	assert.Empty(t, validator.Violations(paginated, Answer{Status: 200, Body: []byte(`{"status":"success","data":[],` + page + `}`)}))
	assert.NotEmpty(t, validator.Violations(paginated, Answer{Status: 200, Body: []byte(`{"status":"success","data":[]}`)}))

	names := Schema{Kind: KindArray, Elem: &Schema{Kind: KindString}}
	variants := Route{Method: "GET", Pattern: "/api/rows/", Variants: &Variants{QueryParam: "view", Default: "full", Cases: map[string]Schema{"full": *route.Response, "names": names}}}
	body := []byte(`{"status":"success","data":["Ada"]}`)
	assert.Empty(t, validator.Violations(variants, Answer{Status: 200, Body: body, Variant: "names"}))
	assert.NotEmpty(t, validator.Violations(variants, Answer{Status: 200, Body: body}), "no selector reads the default case")
	assert.NotEmpty(t, validator.Violations(variants, Answer{Status: 200, Body: body, Variant: "unknown"}))
}

// A plain answer is the data itself, which only a route file reads (#7808).
func TestViolationsReadsAPlainAnswerAsItsData(t *testing.T) {
	t.Parallel()
	doc, route := checkedDocument()
	route.Plain = true
	assert.Empty(t, doc.Violations(route, Answer{Status: 200, Body: []byte(`[` + checkedRow + `]`)}))
	assert.Equal(t, []string{"body: want an array, found {\"status\":\"success\",\"data\":[]}"},
		doc.Violations(route, Answer{Status: 200, Body: []byte(`{"status":"success","data":[]}`)}))
}
