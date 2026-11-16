package contract

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mode string

// wireID and laxID stand for wireID and laxID, which the root
// names; this package must not import them.
type wireID int64

func (wireID) MarshalJSON() ([]byte, error) { return []byte(`"0"`), nil }

type laxID int64

func (laxID) MarshalJSON() ([]byte, error) { return []byte(`0`), nil }

var identifiers = map[reflect.Type]string{reflect.TypeFor[wireID](): KindID, reflect.TypeFor[laxID](): KindLaxID}

type inner struct {
	ID        wireID    `json:"id"`
	Shadowed  string    `json:"shadowed"`
	CreatedAt time.Time `json:"created_at"`
}

type row struct {
	inner
	Shadowed bool           `json:"shadowed"`
	Name     string         `json:"name"`
	Nick     string         `json:"nick,omitempty"`
	Note     *string        `json:"note"`
	Hint     *string        `json:"hint,omitempty"`
	Tags     []string       `json:"tags"`
	Friends  []wireID       `json:"friend_ids,omitempty"`
	Day      calendar.Date  `json:"day"`
	Birthday *calendar.Date `json:"birthday,omitempty"`
	Mode     mode           `json:"mode"`
	Status   string         `json:"status"`
	Count    int            `json:"count"`
	Legacy   int64          `json:"legacy_id"`
	Quoted   int64          `json:"quoted_id,string"`
	Lax      laxID          `json:"lax_id"`
	Weights  map[string]int `json:"weights,omitempty"`
	Hidden   string         `json:"-"`
	Born     string         `json:"born,omitempty" contract:"date"`
	Pickup   *string        `json:"pickup,omitempty" contract:"clock"`
}

type body struct {
	Name string `json:"name"`
	ID   wireID `json:"id"`
}

// ownReader decodes itself; reflection alone cannot say what it takes.
type ownReader struct {
	Friend int64 `json:"friend_id"`
}

func (*ownReader) UnmarshalJSON([]byte) error { return nil }

type legacyBody struct {
	Group int64 `json:"group_id"`
}

func post(request any) Registration {
	return Registration{Method: "POST", Pattern: "/api/rows/", Portals: []string{"tenant"}, Request: request, Response: inner{}}
}

type misformatted struct {
	Count int `json:"count" contract:"clock"`
}

type unknownFormat struct {
	Week string `json:"week" contract:"week"`
}

type stamp struct{}

func (stamp) MarshalJSON() ([]byte, error) { return []byte(`"x"`), nil }

func get(pattern string, response any) Registration {
	return Registration{Method: "GET", Pattern: pattern, Portals: []string{"tenant"}, Response: response}
}

func rowRoute() Registration {
	route := get("/api/rows/{id}", row{})
	route.Enums = []EnumSpec{
		{Type: mode(""), Values: []string{"b", "a"}},
		{Name: "Status", Fields: []string{"row.status"}, Values: []string{"on", "off"}},
	}
	route.DeprecatedFields = []string{"row.nick"}
	return route
}

var rowOptions = Options{NumericIDs: []string{"contract.row.Legacy"}, Identifiers: identifiers}

func fieldsOf(t *testing.T, doc Document, name string) map[string]Field {
	t.Helper()
	for _, object := range doc.Types {
		if object.Name == name {
			fields := map[string]Field{}
			for _, field := range object.Fields {
				fields[field.Name] = field
			}
			return fields
		}
	}
	t.Fatalf("type %s is not in the document", name)
	return nil
}

func TestBuildFollowsEncodingJSON(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{rowRoute()}, rowOptions)
	require.NoError(t, err)
	fields := fieldsOf(t, doc, "row")

	// What the model says must be what encoding/json renders.
	rendered, err := json.Marshal(row{})
	require.NoError(t, err)
	var keys map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rendered, &keys))
	for name, field := range fields {
		raw, present := keys[name]
		assert.Equalf(t, !field.Optional, present, "%s: optional means absent for the zero value", name)
		if present && string(raw) == "null" {
			assert.Truef(t, field.Schema.Nullable, "%s renders null", name)
		}
	}
	assert.Len(t, fields, len(keys)+7, "the seven omitempty fields are absent for the zero value")

	schema := func(name string) Schema { return fields[name].Schema }
	assert.Equal(t, KindBool, schema("shadowed").Kind, "the outer field wins over the embedded one")
	assert.Equal(t, Schema{Kind: KindID}, schema("id"))
	assert.Equal(t, Schema{Kind: KindInstant}, schema("created_at"))
	assert.Equal(t, Schema{Kind: KindString, Nullable: true}, schema("note"))
	assert.Equal(t, Schema{Kind: KindString}, schema("hint"), "a nil pointer with omitempty is absent, never null")
	assert.True(t, schema("tags").Nullable, "a nil slice renders null")
	assert.Equal(t, KindID, schema("friend_ids").Elem.Kind)
	assert.Equal(t, Schema{Kind: KindDate, Nullable: true}, schema("day"), "the zero date renders null")
	assert.Equal(t, Schema{Kind: KindDate}, schema("birthday"))
	assert.Equal(t, Schema{Kind: KindDate}, schema("born"), "the tag names the form of a plain string")
	assert.Equal(t, Schema{Kind: KindClock}, schema("pickup"))
	assert.Equal(t, Schema{Kind: KindEnum, Ref: "mode"}, schema("mode"))
	assert.Equal(t, Schema{Kind: KindEnum, Ref: "Status"}, schema("status"))
	assert.Equal(t, KindInt, schema("count").Kind)
	assert.Equal(t, KindLegacyID, schema("legacy_id").Kind)
	assert.Equal(t, KindID, schema("quoted_id").Kind)
	assert.Equal(t, KindLaxID, schema("lax_id").Kind)
	assert.True(t, fields["nick"].Deprecated)
	assert.NotContains(t, fields, "Hidden")
	assert.Equal(t, []Enum{{Name: "Status", Values: []string{"off", "on"}}, {Name: "mode", Values: []string{"a", "b"}}}, doc.Enums)
}

func TestBuildRejects(t *testing.T) {
	t.Parallel()
	variants := Registration{
		Method: "GET", Pattern: "/api/rows/", Portals: []string{"tenant"},
		Variants: &VariantSpec{QueryParam: "view", Default: "a", ByValue: map[string]any{"a": []inner{}}},
	}
	noPortal := get("/api/rows/", inner{})
	noPortal.Portals = nil
	strayEnum := get("/api/rows/", inner{})
	strayEnum.Enums = []EnumSpec{{Name: "Gone", Fields: []string{"inner.gone"}, Values: []string{"x"}}}

	cases := map[string]struct {
		routes  []Registration
		options Options
		message string
	}{
		"an int64 that does not say what it is": {[]Registration{rowRoute()}, Options{Identifiers: identifiers}, "int64 does not say what it is"},
		"a response shape chosen by the query":  {[]Registration{variants}, Options{Identifiers: identifiers}, "depends on ?view"},
		"an anonymous struct": {[]Registration{get("/api/rows/", struct {
			S stamp `json:"s"`
		}{})}, Options{Identifiers: identifiers}, "anonymous struct"},
		"an unknown marshaler in a named type":      {[]Registration{get("/api/rows/", []stamp{})}, Options{Identifiers: identifiers}, "has its own MarshalJSON"},
		"a route without a portal":                  {[]Registration{noPortal}, Options{Identifiers: identifiers}, "names no portal"},
		"a route registered twice":                  {[]Registration{get("/api/rows/", inner{}), get("/api/rows/", inner{})}, Options{Identifiers: identifiers}, "registered twice"},
		"a numeric id entry nothing uses":           {[]Registration{get("/api/rows/", inner{})}, Options{NumericIDs: []string{"gone.Type.ID"}, Identifiers: identifiers}, "numeric id gone.Type.ID"},
		"a variant entry nothing uses":              {[]Registration{get("/api/rows/", inner{})}, Options{QueryVariants: []string{"GET /api/gone/"}, Identifiers: identifiers}, "query variant GET /api/gone/"},
		"a format tag on a field that is no string": {[]Registration{get("/api/rows/", misformatted{})}, Options{Identifiers: identifiers}, `contract:"clock" needs a string field`},
		"an unknown format tag":                     {[]Registration{get("/api/rows/", unknownFormat{})}, Options{Identifiers: identifiers}, `contract:"week" needs a string field`},
		"a request type that reads itself":          {[]Registration{post(ownReader{})}, Options{Identifiers: identifiers}, "has its own UnmarshalJSON"},
		"a reader entry nothing uses":               {[]Registration{get("/api/rows/", inner{})}, Options{Identifiers: identifiers, Readers: map[reflect.Type]string{reflect.TypeFor[ownReader](): ReadsFields}}, "reader contract.ownReader"},
		"an enum field nothing uses":                {[]Registration{strayEnum}, Options{Identifiers: identifiers}, "enum field inner.gone"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := Build(tc.routes, tc.options)
			assert.ErrorContains(t, err, tc.message)
		})
	}
}

func TestBuildAllowsALegacyQueryVariant(t *testing.T) {
	t.Parallel()
	route := Registration{
		Method: "GET", Pattern: "/api/rows/", Portals: []string{"tenant"}, Paginated: true,
		Query:    []QueryParam{{Name: "view", Kind: "string", Values: []string{"b", "a"}}},
		Variants: &VariantSpec{QueryParam: "view", Default: "a", ByValue: map[string]any{"a": []inner{}, "b": []body{}}},
	}
	doc, err := Build([]Registration{route}, Options{QueryVariants: []string{"GET /api/rows/"}, Identifiers: identifiers})
	require.NoError(t, err)
	assert.Equal(t, Schema{Kind: KindArray, Elem: &Schema{Kind: KindRef, Ref: "body"}}, doc.Routes[0].Variants.Cases["b"])
	assert.Equal(t, []string{"a", "b"}, doc.Routes[0].Query[0].Values)
}

func TestARequestBodyHasOnlyOptionalFields(t *testing.T) {
	t.Parallel()
	route := Registration{Method: "POST", Pattern: "/api/rows/", Portals: []string{"tenant"}, Request: body{}, Response: inner{}}
	doc, err := Build([]Registration{route}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	for name, field := range fieldsOf(t, doc, "body") {
		assert.Truef(t, field.Optional, "%s", name)
	}
}

func TestARequestTypeNamesWhatGoReads(t *testing.T) {
	t.Parallel()
	options := Options{
		Identifiers: identifiers,
		NumericIDs:  []string{"contract.legacyBody.Group"},
		Readers:     map[reflect.Type]string{reflect.TypeFor[ownReader](): ReadsLaxIDs},
	}
	lax := post(ownReader{})
	legacy := Registration{Method: "PUT", Pattern: "/api/rows/{id}", Portals: []string{"tenant"}, Request: legacyBody{}, Response: inner{}}
	doc, err := Build([]Registration{lax, legacy}, options)
	require.NoError(t, err)
	assert.Equal(t, KindLaxID, fieldsOf(t, doc, "ownReader")["friend_id"].Schema.Kind, "its reader takes a number or a string")
	assert.Equal(t, KindLegacyID, fieldsOf(t, doc, "legacyBody")["group_id"].Schema.Kind)

	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["rows.generated.ts"]
	for _, line := range []string{
		"  friend_id?: string;",
		"  group_id?: number;",
		"    request: requestBody<ownReader>(),",
		"    request: requestBody<legacyBody>(),",
	} {
		assert.Contains(t, source, line)
	}
	assert.NotContains(t, source, "legacyBodySchema", "a request has no decoder")

	// The same entry on a response still leaves the decoder as a string.
	response := get("/api/legacy/", legacyBody{})
	doc, err = Build([]Registration{response}, Options{Identifiers: identifiers, NumericIDs: []string{"contract.legacyBody.Group"}})
	require.NoError(t, err)
	files, err = TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["legacy.generated.ts"], "  group_id: string;")
}

func TestTypeScriptWritesTypesBeforeTheirUse(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{rowRoute()}, rowOptions)
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["rows.generated.ts"]
	require.NotEmpty(t, source)
	for _, line := range []string{
		`export const MODE_VALUES = ["a", "b"] as const;`,
		"  id: string;",
		"  note: string | null;",
		"  hint?: string;",
		"  tags: string[] | null;",
		"  mode: OpenEnum<mode>;",
		"  /** @deprecated leaves the contract with the next release */\n  nick?: string;",
		"  legacy_id: int64StringOrNumber,",
		"  friend_ids: z.array(int64String).optional(),",
		"  day: calendarDate.nullable(),",
		"  hint: z.string().optional(),",
		`  "GET /api/rows/{id}": {`,
		"    response: success(rowSchema),",
	} {
		assert.Contains(t, source, line)
	}
}

func TestTypeScriptListsTheRoutesOfEachPortal(t *testing.T) {
	t.Parallel()
	staff := get("/api/rows/{id}", inner{})
	staff.Query = []QueryParam{{Name: "view", Kind: "string"}, {Name: "page", Kind: "int"}}
	shared := get("/parent/me/rows", body{})
	shared.Portals = []string{"tenant", "parent"}
	doc, err := Build([]Registration{staff, shared}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)

	assert.Contains(t, files["rows.generated.ts"], `    query: ["page", "view"],`)
	table := files["portals.generated.ts"]
	for _, line := range []string{
		`import { routes as parentMe } from "./parent-me.generated";`,
		"  parent: [\n    parentMe[\"GET /parent/me/rows\"],\n  ],",
		"  tenant: [\n    parentMe[\"GET /parent/me/rows\"],\n    rows[\"GET /api/rows/{id}\"],\n  ],",
	} {
		assert.Contains(t, table, line)
	}

	for _, pattern := range []string{"/api/portals/", "/api/shared/"} {
		doc, err = Build([]Registration{get(pattern, inner{})}, Options{Identifiers: identifiers})
		require.NoError(t, err)
		_, err = TypeScript(doc)
		assert.ErrorContains(t, err, "taken by a generated table")
	}
}

// Two portals mount the same handlers, so two resources answer with one Go
// type. It is written once and both files import it.
func TestTypeScriptWritesATypeOfTwoResourcesOnce(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{rowRoute(), get("/school/rows/{id}", row{}), get("/api/others/", inner{})}, rowOptions)
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)

	shared := files["shared.generated.ts"]
	assert.Contains(t, shared, `export const MODE_VALUES = ["a", "b"] as const;`)
	assert.Contains(t, shared, "export const rowSchema: z.ZodType<row, unknown> = z.object({")
	assert.NotContains(t, shared, "export const routes")
	for _, name := range []string{"rows.generated.ts", "school-rows.generated.ts"} {
		assert.Contains(t, files[name], "import {\n  rowSchema,\n} from \"./shared.generated\";", name)
		assert.NotContains(t, files[name], "export interface row ", name)
		assert.NotContains(t, files[name], `from "zod"`, name)
		assert.Contains(t, files[name], "    response: success(rowSchema),", name)
	}
	// A type of one resource stays in its file.
	assert.Contains(t, files["others.generated.ts"], "export interface inner {")
	assert.NotContains(t, shared, "interface inner ")
}
