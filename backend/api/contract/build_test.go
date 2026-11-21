package contract

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
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
	// An amount in cent and a running number travel as plain numbers.
	PriceCents int64            `json:"price_cents"`
	Next       int64            `json:"next" contract:"number"`
	Image      []byte           `json:"image"`
	BySchool   map[int64]string `json:"by_school"`
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
	assert.Equal(t, Schema{Kind: KindInt}, schema("price_cents"), "an amount in cent is a number")
	assert.Equal(t, Schema{Kind: KindInt}, schema("next"), "a running number tagged number stays a number")
	assert.Equal(t, Schema{Kind: KindString, Nullable: true}, schema("image"), "[]byte renders base64, nil as null")
	assert.Equal(t, KindMap, schema("by_school").Kind, "an integer key renders as its decimal string")
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
	bothAnswers := get("/api/rows/", inner{})
	bothAnswers.NoData = true
	strayEnum := get("/api/rows/", inner{})
	strayEnum.Enums = []EnumSpec{{Name: "Gone", Fields: []string{"inner.gone"}, Values: []string{"x"}}}
	limitWithoutBody := get("/api/rows/", inner{})
	limitWithoutBody.MaxBodyBytes = 1024
	negativeLimit := post(body{})
	negativeLimit.MaxBodyBytes = -1
	publicWrite := post(body{})
	publicWrite.Portals = []string{PublicPortal}
	publicRetry := get("/api/links/{token}", inner{})
	publicRetry.Portals = []string{PublicPortal}
	publicRetry.NoRetryAfterRenewal = "mails a code"
	publicBeside := get("/api/links/{token}", inner{})
	publicBeside.Portals = []string{PublicPortal, "tenant"}
	publicLink := get("/api/rows/{token}", inner{})
	publicLink.Portals = []string{PublicPortal}
	fileAndJSON := get("/api/rows/export", inner{})
	fileAndJSON.File = true
	publicFile := fileRoute("/api/links/{token}/file")
	publicFile.Portals = []string{PublicPortal}
	markedSessionFile := fileRoute("/api/rows/{id}/file")
	markedSessionFile.PublicFile = "the link is the credential"
	markedPublicJSON := get("/api/links/{token}", inner{})
	markedPublicJSON.Portals = []string{PublicPortal}
	markedPublicJSON.PublicFile = "the link is the credential"
	publicFileWithBody := fileRoute("/api/links/{token}/file")
	publicFileWithBody.Method = "POST"
	publicFileWithBody.Portals = []string{PublicPortal}
	publicFileWithBody.PublicFile = "the link is the credential"
	publicFileWithBody.Request = body{}
	publicFileWithBody.MaxBodyBytes = 1024
	publicUpload := upload()
	publicUpload.Portals = []string{PublicPortal}
	markedSessionUpload := upload()
	markedSessionUpload.PublicUpload = "the form is public"
	markedPublicJSONWrite := get("/api/links/{token}", inner{})
	markedPublicJSONWrite.Portals = []string{PublicPortal}
	markedPublicJSONWrite.PublicUpload = "the form is public"

	cachedJSON := get("/api/rows/{id}", inner{})
	cachedJSON.FileCache = contractmodel.FileCachePrivateHour
	unknownCache := fileRoute("/api/rows/{id}/file")
	unknownCache.FileCache = "public, max-age=31536000"
	publicCacheOnSession := fileRoute("/api/rows/{id}/file")
	publicCacheOnSession.FileCache = contractmodel.FileCachePublicAsset
	conditionalWithoutCache := fileRoute("/api/rows/{id}/file")
	conditionalWithoutCache.ConditionalGet = true
	uploadWithoutLimit := upload()
	uploadWithoutLimit.MaxBodyBytes = 0
	uploadWithoutCode := upload()
	uploadWithoutCode.TooLargeCode = ""
	uploadAndBody := upload()
	uploadAndBody.Request = body{}
	uploadAndFile := upload()
	uploadAndFile.Response = nil
	uploadAndFile.File = true
	uploadOnGet := upload()
	uploadOnGet.Method = "GET"
	uploadRetry := upload()
	uploadRetry.NoRetryAfterRenewal = "stores the file twice"
	strayCode := post(body{})
	strayCode.TooLargeCode = "files.file_too_large"
	jsonCache := get("/api/rows/", inner{})
	jsonCache.PrivateCache = true
	publicCache := fileRoute("/api/links/{token}/file")
	publicCache.Portals = []string{PublicPortal}
	publicCache.PublicFile = "the link is the credential"
	publicCache.PrivateCache = true

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
		"an unknown marshaler in a named type":       {[]Registration{get("/api/rows/", []stamp{})}, Options{Identifiers: identifiers}, "has its own MarshalJSON"},
		"a response on a route without data":         {[]Registration{bothAnswers}, Options{Identifiers: identifiers}, "registers a response and no data"},
		"a route without a portal":                   {[]Registration{noPortal}, Options{Identifiers: identifiers}, "names no portal"},
		"a route registered twice":                   {[]Registration{get("/api/rows/", inner{}), get("/api/rows/", inner{})}, Options{Identifiers: identifiers}, "registered twice"},
		"a numeric id entry nothing uses":            {[]Registration{get("/api/rows/", inner{})}, Options{NumericIDs: []string{"gone.Type.ID"}, Identifiers: identifiers}, "numeric id gone.Type.ID"},
		"a variant entry nothing uses":               {[]Registration{get("/api/rows/", inner{})}, Options{QueryVariants: []string{"GET /api/gone/"}, Identifiers: identifiers}, "query variant GET /api/gone/"},
		"a format tag on a field that is no string":  {[]Registration{get("/api/rows/", misformatted{})}, Options{Identifiers: identifiers}, `contract:"clock" needs a string field`},
		"an unknown format tag":                      {[]Registration{get("/api/rows/", unknownFormat{})}, Options{Identifiers: identifiers}, `contract:"week" needs a string field`},
		"a request type that reads itself":           {[]Registration{post(ownReader{})}, Options{Identifiers: identifiers}, "has its own UnmarshalJSON"},
		"a reader entry nothing uses":                {[]Registration{get("/api/rows/", inner{})}, Options{Identifiers: identifiers, Readers: map[reflect.Type]string{reflect.TypeFor[ownReader](): ReadsFields}}, "reader contract.ownReader"},
		"an enum field nothing uses":                 {[]Registration{strayEnum}, Options{Identifiers: identifiers}, "enum field inner.gone"},
		"a day type entry nothing uses":              {[]Registration{get("/api/rows/", inner{})}, Options{Identifiers: identifiers, Dates: []reflect.Type{reflect.TypeFor[ownDay]()}}, "day type contract.ownDay"},
		"an instant type entry nothing uses":         {[]Registration{get("/api/rows/", inner{})}, Options{Identifiers: identifiers, Instants: []reflect.Type{reflect.TypeFor[stamp]()}}, "instant type contract.stamp"},
		"an owner's day type without an entry":       {[]Registration{get("/api/rows/", dayRow{})}, Options{Identifiers: identifiers}, "has its own MarshalJSON"},
		"a body limit on a route without a body":     {[]Registration{limitWithoutBody}, Options{Identifiers: identifiers}, "a body limit needs a positive size and a request body"},
		"a negative body limit":                      {[]Registration{negativeLimit}, Options{Identifiers: identifiers}, "a body limit needs a positive size and a request body"},
		"a public write without a body limit":        {[]Registration{publicWrite}, Options{Identifiers: identifiers}, "a public write needs MaxBodyBytes"},
		"a public route that names a retry":          {[]Registration{publicRetry}, Options{Identifiers: identifiers}, "has no session to renew"},
		"a public route beside a session portal":     {[]Registration{publicBeside}, Options{Identifiers: identifiers}, "names no session portal"},
		"a public pattern a session pattern takes":   {[]Registration{publicLink, get("/api/rows/{id}", inner{})}, Options{Identifiers: identifiers}, "overlaps the session route GET /api/rows/{id}"},
		"a file with a JSON response":                {[]Registration{fileAndJSON}, Options{Identifiers: identifiers}, "registers a file and a JSON response"},
		"a public file":                              {[]Registration{publicFile}, Options{Identifiers: identifiers}, "answers JSON only"},
		"a public file marker on a session file":     {[]Registration{markedSessionFile}, Options{Identifiers: identifiers}, "PublicFile marks a file of the portal"},
		"a public file marker on a JSON route":       {[]Registration{markedPublicJSON}, Options{Identifiers: identifiers}, "PublicFile marks a file of the portal"},
		"a public file that reads a body":            {[]Registration{publicFileWithBody}, Options{Identifiers: identifiers}, "a public file reads no request body"},
		"a public upload":                            {[]Registration{publicUpload}, Options{Identifiers: identifiers}, "takes no upload"},
		"a public upload marker on a session upload": {[]Registration{markedSessionUpload}, Options{Identifiers: identifiers}, "PublicUpload marks a multipart upload"},
		"a public upload marker on a JSON route":     {[]Registration{markedPublicJSONWrite}, Options{Identifiers: identifiers}, "PublicUpload marks a multipart upload"},
		"a cache trait on a JSON route":              {[]Registration{cachedJSON}, Options{Identifiers: identifiers}, "FileCache belongs to a file route"},
		"a cache value nobody reviewed":              {[]Registration{unknownCache}, Options{Identifiers: identifiers}, "none of the reviewed values"},
		"a public cache on a session file":           {[]Registration{publicCacheOnSession}, Options{Identifiers: identifiers}, "a public FileCache needs PublicFile"},
		"a conditional GET without a cache":          {[]Registration{conditionalWithoutCache}, Options{Identifiers: identifiers}, "ConditionalGet belongs to a GET file route with FileCache"},
		"an upload without a body limit":             {[]Registration{uploadWithoutLimit}, Options{Identifiers: identifiers}, "needs MaxBodyBytes and TooLargeCode"},
		"an upload without its too large code":       {[]Registration{uploadWithoutCode}, Options{Identifiers: identifiers}, "needs MaxBodyBytes and TooLargeCode"},
		"an upload beside a JSON body":               {[]Registration{uploadAndBody}, Options{Identifiers: identifiers}, "a multipart upload and a JSON request body"},
		"an upload with a file response":             {[]Registration{uploadAndFile}, Options{Identifiers: identifiers}, "a multipart upload cannot answer a file"},
		"an upload on a GET":                         {[]Registration{uploadOnGet}, Options{Identifiers: identifiers}, "is a POST, PUT or PATCH"},
		"an upload that names a retry":               {[]Registration{uploadRetry}, Options{Identifiers: identifiers}, "is sent once"},
		"a too large code without an upload":         {[]Registration{strayCode}, Options{Identifiers: identifiers}, "TooLargeCode belongs to a multipart upload"},
		"a private cache trait on a JSON route":      {[]Registration{jsonCache}, Options{Identifiers: identifiers}, "PrivateCache belongs to a file route of a session portal"},
		"a cache trait on a public file":             {[]Registration{publicCache}, Options{Identifiers: identifiers}, "PrivateCache belongs to a file route of a session portal"},
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

// A request field of the strict identifier type is a string in the client
// and has no decoder: Go reads it (common.ID reads a string or a number), so
// a legacy request field moves to common.ID without a generator change.
func TestARequestIdentifierIsAStringWithoutDecoder(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{post(body{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	assert.Equal(t, KindID, fieldsOf(t, doc, "body")["id"].Schema.Kind)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["rows.generated.ts"]
	assert.Contains(t, source, "  id?: string;")
	assert.Contains(t, source, "    request: requestBody<body>(),")
	assert.NotContains(t, source, "bodySchema", "a request has no decoder")
	assert.NotContains(t, source, "int64StringOrNumber", "the answer carries only strict identifiers")
}

// ownDay is a day type an owner keeps beside calendar.Date: it writes
// "YYYY-MM-DD" and its zero value as null.
type ownDay string

func (d ownDay) MarshalJSON() ([]byte, error) {
	if d == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(d))
}

type dayRow struct {
	Day      ownDay            `json:"day"`
	Optional ownDay            `json:"optional,omitempty"`
	Until    *ownDay           `json:"until,omitempty"`
	Answers  map[ownDay]string `json:"answers,omitempty"`
}

func TestARootNamedDayTypeTravelsAsADate(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{get("/api/rows/", dayRow{})}, Options{Identifiers: identifiers, Dates: []reflect.Type{reflect.TypeFor[ownDay]()}})
	require.NoError(t, err)
	fields := fieldsOf(t, doc, "dayRow")
	assert.Equal(t, Schema{Kind: KindDate, Nullable: true}, fields["day"].Schema, "the zero value renders as null")
	assert.Equal(t, Schema{Kind: KindDate}, fields["optional"].Schema, "omitempty leaves the empty day out")
	assert.True(t, fields["optional"].Optional)
	assert.Equal(t, Schema{Kind: KindDate}, fields["until"].Schema)
	assert.Equal(t, KindMap, fields["answers"].Schema.Kind, "a day keys a map as its string")
}

type stampRow struct {
	At    stamp  `json:"at"`
	Until *stamp `json:"until,omitempty"`
}

func TestARootNamedInstantTypeTravelsAsAnInstant(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{get("/api/rows/", stampRow{})}, Options{Identifiers: identifiers, Instants: []reflect.Type{reflect.TypeFor[stamp]()}})
	require.NoError(t, err)
	fields := fieldsOf(t, doc, "stampRow")
	assert.Equal(t, Schema{Kind: KindInstant}, fields["at"].Schema)
	assert.Equal(t, Schema{Kind: KindInstant}, fields["until"].Schema)
	assert.True(t, fields["until"].Optional)
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
		"  friend_ids: optional(arr(int64String)),",
		"  day: nullable(calendarDate),",
		"  hint: optional(str),",
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

	// A resource named like a keyword gets a binding that is no keyword.
	doc, err = Build([]Registration{get("/api/import/rows", inner{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err = TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["portals.generated.ts"], `import { routes as importRoutes } from "./import.generated";`)
	assert.Contains(t, files["portals.generated.ts"], `    importRoutes["GET /api/import/rows"],`)

	for _, pattern := range []string{"/api/portals/", "/api/shared/"} {
		doc, err = Build([]Registration{get(pattern, inner{})}, Options{Identifiers: identifiers})
		require.NoError(t, err)
		_, err = TypeScript(doc)
		assert.ErrorContains(t, err, "taken by a generated table")
	}
}

// A route that answers 204 or the bare envelope names no response type; its
// decoder takes exactly those two answers.
func TestTypeScriptWritesARouteWithoutData(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{{Method: "DELETE", Pattern: "/api/rows/{id}", Portals: []string{"tenant"}, NoData: true}}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	assert.True(t, doc.Routes[0].NoData)
	assert.Nil(t, doc.Routes[0].Response)
	files, err := TypeScript(doc)
	require.NoError(t, err)

	source := files["rows.generated.ts"]
	assert.Contains(t, source, "import {\n  noData,\n} from \"./runtime\";")
	assert.Contains(t, source, "    response: noData,\n")
	assert.NotContains(t, source, "success")
}

// The proxy traits travel into contract.json and onto the route object the
// catalog proxy reads; a route without them carries neither key.
func TestTypeScriptWritesTheProxyTraitsOfARoute(t *testing.T) {
	t.Parallel()
	once := post(body{})
	once.NoRetryAfterRenewal = "a renewed session would mail the code twice"
	once.MaxBodyBytes = 64 * 1024
	plain := get("/api/rows/{id}", inner{})
	doc, err := Build([]Registration{once, plain}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	encoded, err := json.Marshal(doc.Routes)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"no_retry_after_renewal":"a renewed session would mail the code twice","max_body_bytes":65536`)
	files, err := TypeScript(doc)
	require.NoError(t, err)

	source := files["rows.generated.ts"]
	assert.Contains(t, source, "    pattern: \"/api/rows/\",\n    portals: [\"tenant\"],\n    noRetryAfterRenewal: \"a renewed session would mail the code twice\",\n    maxBodyBytes: 65536,\n")
	assert.Equal(t, 1, strings.Count(source, "noRetryAfterRenewal"))
	assert.Equal(t, 1, strings.Count(source, "maxBodyBytes"))
}

func fileRoute(pattern string) Registration {
	return Registration{Method: "GET", Pattern: pattern, Portals: []string{"tenant"}, File: true}
}

func upload() Registration {
	return Registration{
		Method: "POST", Pattern: "/api/rows/{id}/files", Portals: []string{"tenant"},
		Multipart: true, MaxBodyBytes: 1 << 20, TooLargeCode: "files.file_too_large", Response: inner{},
	}
}

// A file answer and a multipart upload are kinds of their own in the model
// and on the route object: no decoder for the file, no body type for the
// upload, and the upload names its limit and the code of a larger body.
func TestTypeScriptWritesAFileAndAnUpload(t *testing.T) {
	t.Parallel()
	export := fileRoute("/api/rows/export")
	export.Query = []QueryParam{{Name: "format", Kind: "string"}}
	doc, err := Build([]Registration{export, upload()}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	encoded, err := json.Marshal(doc.Routes)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"file":true`)
	assert.Contains(t, string(encoded), `"max_body_bytes":1048576,"multipart":true,"too_large_code":"files.file_too_large"`)
	assert.Nil(t, doc.Routes[0].Response)
	files, err := TypeScript(doc)
	require.NoError(t, err)

	source := files["rows.generated.ts"]
	cached := fileRoute("/api/rows/{id}/avatar")
	cached.PrivateCache = true
	cachedDoc, err := Build([]Registration{cached}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	cachedFiles, err := TypeScript(cachedDoc)
	require.NoError(t, err)
	assert.Contains(t, cachedFiles["rows.generated.ts"], "    privateCache: true,\n    response: fileAnswer,\n")
	assert.Contains(t, source, "  \"GET /api/rows/export\": {\n    method: \"GET\",\n    pattern: \"/api/rows/export\",\n    portals: [\"tenant\"],\n    query: [\"format\"],\n    response: fileAnswer,\n  },\n")
	assert.Contains(t, source, "    maxBodyBytes: 1048576,\n    tooLargeCode: \"files.file_too_large\",\n    request: multipart,\n    response: success(innerSchema),\n")
	assert.Contains(t, source, "  fileAnswer,\n")
	assert.Contains(t, source, "  multipart,\n")
	assert.NotContains(t, source, "requestBody")
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
	assert.Contains(t, shared, "  type OpenEnum,\n} from \"./runtime\";")
	assert.Contains(t, shared, "  mode: OpenEnum<mode>;")
	assert.Contains(t, shared, `export const MODE_VALUES = ["a", "b"] as const;`)
	assert.Contains(t, shared, "export const rowSchema: z.ZodType<row, unknown> = object<row>({")
	assert.NotContains(t, shared, "export const routes")
	for _, name := range []string{"rows.generated.ts", "school-rows.generated.ts"} {
		assert.Contains(t, files[name], "import {\n  rowSchema,\n} from \"./shared.generated\";", name)
		assert.NotContains(t, files[name], "export interface row ", name)
		assert.NotContains(t, files[name], "type OpenEnum", name)
		assert.NotContains(t, files[name], `from "zod"`, name)
		assert.Contains(t, files[name], "    response: success(rowSchema),", name)
	}
	// A type of one resource stays in its file.
	assert.Contains(t, files["others.generated.ts"], "export interface inner {")
	assert.NotContains(t, shared, "interface inner ")
}

func TestTypeScriptImportsOpenEnumForASharedRequest(t *testing.T) {
	t.Parallel()
	type enumBody struct {
		Modes map[string][]mode `json:"modes"`
	}
	first := post(enumBody{})
	first.Response = ""
	first.Enums = []EnumSpec{{Type: mode(""), Values: []string{"a", "b"}}}
	second := first
	second.Pattern = "/school/rows/"
	doc, err := Build([]Registration{first, second}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)

	shared := files["shared.generated.ts"]
	assert.Contains(t, shared, "import {\n  type OpenEnum,\n} from \"./runtime\";")
	assert.Contains(t, shared, "  modes?: Record<string, OpenEnum<mode>[] | null> | null;")
	assert.NotContains(t, shared, `from "zod"`, "a request has no decoder")
	for _, name := range []string{"rows.generated.ts", "school-rows.generated.ts"} {
		assert.Contains(t, files[name], "type enumBody,", name)
		assert.Contains(t, files[name], "    request: requestBody<enumBody>(),", name)
		assert.NotContains(t, files[name], "type OpenEnum", name)
	}
}

// A route that may answer "there is none now" registers a pointer: its data
// is the object or null. Every other registered object is never null.
func TestARegisteredPointerAnswersTheObjectOrNull(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{get("/api/rows/current", &inner{}), get("/api/rows/{id}", inner{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["rows.generated.ts"]
	assert.Contains(t, source, "response: success(innerSchema.nullable()),")
	assert.Contains(t, source, "response: success(innerSchema),")
}

// stored hands on JSON its owner stored without reading it.
type stored struct {
	Old json.RawMessage `json:"old,omitempty"`
	Raw json.RawMessage `json:"raw"`
	Any any             `json:"any"`
}

// presence tells an absent key from null, as the template writes do.
type presence struct {
	Set   bool
	Value *int64
}

func (p *presence) UnmarshalJSON(data []byte) error {
	p.Set = true
	return json.Unmarshal(data, &p.Value)
}

type presenceBody struct {
	Track presence `json:"track_id"`
}

func TestARawValueAndAValueReaderTravelAsWhatTheyHold(t *testing.T) {
	t.Parallel()
	options := Options{
		Identifiers: identifiers,
		NumericIDs:  []string{"contract.presence.Value"},
		Readers:     map[reflect.Type]string{reflect.TypeFor[presence](): ReadsValue},
	}
	doc, err := Build([]Registration{get("/api/stored/", stored{}), post(presenceBody{})}, options)
	require.NoError(t, err)
	fields := fieldsOf(t, doc, "stored")
	assert.Equal(t, Schema{Kind: KindJSON, Nullable: true}, fields["raw"].Schema, "any JSON value, null included")
	assert.Equal(t, Schema{Kind: KindJSON, Nullable: true}, fields["old"].Schema, "omitempty leaves an empty value out; a stored null still travels")
	assert.Equal(t, Schema{Kind: KindJSON, Nullable: true}, fields["any"].Schema, "an empty interface holds any JSON")
	assert.True(t, fields["old"].Optional)
	assert.Equal(t, Schema{Kind: KindLegacyID, Nullable: true}, fieldsOf(t, doc, "presenceBody")["track_id"].Schema, "the wrapper reads its Value")

	files, err := TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["stored.generated.ts"], "  raw: unknown | null;")
	assert.Contains(t, files["stored.generated.ts"], "raw: nullable(json),")
	assert.Contains(t, files["rows.generated.ts"], "  track_id?: number | null;")

	_, err = Build([]Registration{post(presenceBody{})}, Options{Identifiers: identifiers, NumericIDs: options.NumericIDs})
	require.ErrorContains(t, err, "has its own UnmarshalJSON", "without an entry the wrapper stops the generator")
}

// session and supervisor refer to each other, as a room session and its
// supervisions do.
type session struct {
	Name        string        `json:"name"`
	Supervisors []*supervisor `json:"supervisors,omitempty"`
}

type supervisor struct {
	Role    string   `json:"role"`
	Session *session `json:"session,omitempty"`
}

func TestATypeOfACycleReadsTheLaterSchemaLazily(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{get("/api/rows/sessions", []session{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["rows.generated.ts"]
	first, second := strings.Index(source, "export const supervisorSchema"), strings.Index(source, "export const sessionSchema")
	require.True(t, first >= 0 && second > first, source)
	assert.Contains(t, source, "  session: optional(lazy(() => sessionSchema)),")
	assert.Contains(t, source, "  supervisors: optional(arr(nullable(supervisorSchema))),")
}

// A public file opens only with its own marker, and the marker travels to
// the proxy, which serves no unmarked public file (ADR 0270, #2352).
func TestAMarkedPublicFileIsBuiltWithItsReason(t *testing.T) {
	t.Parallel()
	download := fileRoute("/api/links/{token}")
	download.Method = "POST"
	download.Portals = []string{PublicPortal}
	download.PublicFile = "the link of the mail is the credential"
	doc, err := Build([]Registration{download}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	encoded, err := json.Marshal(doc.Routes)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"file":true,"public_file":"the link of the mail is the credential"`)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["links.generated.ts"], "    portals: [\"public\"],\n    publicFile: \"the link of the mail is the credential\",\n")
}

// A public upload opens only with its own marker, which travels to the
// proxy beside the upload's bound and code (ADR 0270, #2352).
func TestAMarkedPublicUploadIsBuiltWithItsReason(t *testing.T) {
	t.Parallel()
	proof := upload()
	proof.Pattern = "/api/links/{token}/uploads"
	proof.Portals = []string{PublicPortal}
	proof.PublicUpload = "the link is the parents' only credential"
	doc, err := Build([]Registration{proof}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["links.generated.ts"], "    publicUpload: \"the link is the parents' only credential\",\n")
	assert.Contains(t, files["links.generated.ts"], "    request: multipart,\n")
}

// A file route's cache traits travel to the proxy, which keeps no other
// Cache-Control on a file than the one its contract names (#2352).
func TestAFileRouteCarriesItsCacheTraits(t *testing.T) {
	t.Parallel()
	photo := fileRoute("/api/rows/{id}/photo/{filename}")
	photo.FileCache = contractmodel.FileCachePrivateImmutableDay
	photo.ConditionalGet = true
	asset := fileRoute("/public/assets/{filename}")
	asset.Portals = []string{PublicPortal}
	asset.PublicFile = "a school's public asset"
	asset.FileCache = contractmodel.FileCachePublicAsset
	doc, err := Build([]Registration{photo, asset}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["rows.generated.ts"], "    fileCache: \"private, max-age=86400, immutable\",\n    conditionalGet: true,\n")
	assert.Contains(t, files["public-assets.generated.ts"], "    publicFile: \"a school's public asset\",\n    fileCache: \"public, max-age=86400\",\n")
}

func TestAPublicRouteMayStandBesideAnOrderedSessionRoute(t *testing.T) {
	t.Parallel()
	link := get("/api/rows/public/{token}", inner{})
	link.Portals = []string{PublicPortal}
	// /api/rows/public/x/ matches both; the literal "public" wins in chi
	// and in the proxy, so the pair is ordered.
	_, err := Build([]Registration{link, get("/api/rows/{id}/history", inner{})}, Options{Identifiers: identifiers})
	assert.NoError(t, err)
}

func TestResourceAliasAvoidsReservedWords(t *testing.T) {
	t.Parallel()
	for resource, want := range map[string]string{
		"import":         "importRoutes",
		"meal-plan":      "mealPlan",
		"week-protocols": "weekProtocols",
	} {
		if got := resourceAlias(resource); got != want {
			t.Errorf("resourceAlias(%q) = %q, want %q", resource, got, want)
		}
	}
}
