//go:build testhooks

package common

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// Every test binary holds the success answers its handlers write against
// the committed contract (ADR 0270): the BFF answers 502 for a body its
// decoder refuses, and no type check sees that.
//
// A test of the whole router knows the route by its full pattern and holds
// it to everything the contract says. A route-sized router knows only the
// pattern below its mount; there the answer is held to the registered routes
// that end in this pattern and answer with this Go type, so a handler that
// writes a different type than it registered shows only in a whole-router
// test.
func init() {
	answerObserver = observeAnswerContract
	refusalObserver = observeRefusal
	problemDetailsObserver = observeProblemDetailsContract
}

func observeProblemDetailsContract(r *http.Request, code string, details any) error {
	// Direct renderer unit tests use a synthetic request, not a handler.
	if chi.RouteContext(r.Context()) == nil {
		return nil
	}
	// Refreshing the route catalog precedes rebuilding the contract from it.
	if update := flag.Lookup("update-goldens"); update != nil && update.Value.String() == "true" {
		return nil
	}
	loaded := loadAnswerContract()
	pattern := RoutePattern(r)
	route := r.Method + " " + pattern
	for _, outside := range loaded.doc.Outside {
		if outside.Reason == "device" && outside.Key() == route {
			return nil
		}
	}
	if partial, ok := details.(PartialImportDetails); ok {
		return loaded.checkPartialDetails(r.Method, pattern, code, partial)
	}
	return loaded.checkProblemDetails(route, code, details)
}

func (loaded *answerContract) checkProblemDetails(route, code string, details any) error {
	schema, ok := loaded.doc.ProblemDetails[code]
	theType := reflect.TypeOf(details)
	if !ok || theType == nil || theType.Kind() != reflect.Struct ||
		theType.PkgPath() != schema.GoPackage || loaded.goTypes[schema.Ref] != theType.String() {
		return fmt.Errorf("%s: %s details from %T do not match their registered Go type %q", route, code, details, loaded.goTypes[schema.Ref])
	}
	return nil
}

func (loaded *answerContract) checkPartialDetails(method, pattern, code string, partial PartialImportDetails) error {
	routes, _ := loaded.candidates(method, pattern, partial.Result)
	for _, route := range routes {
		if route.PartialError != code || !loaded.answersWith(route, partial.Result) {
			continue
		}
		if partial.Rejection != nil && partial.Rejection.Details != nil {
			return loaded.checkProblemDetails(route.Key(), partial.Rejection.Code, partial.Rejection.Details)
		}
		return nil
	}
	return fmt.Errorf("%s %s: %s has no matching PartialError for result %T", method, pattern, code, partial.Result)
}

// answersFileEnv names a file that collects the key of every registered
// route a test unambiguously identified and answered, one per line, to
// measure which routes no test reaches.
const answersFileEnv = "CONTRACT_ANSWERS_FILE"

type answerContract struct {
	doc     contractmodel.Document
	byKey   map[string]contractmodel.Route
	goTypes map[string]string
}

var loadAnswerContract = sync.OnceValue(func() *answerContract {
	dir, err := os.Getwd()
	if err != nil {
		panic("answer contract: " + err.Error())
	}
	for {
		raw, err := os.ReadFile(filepath.Join(dir, "api", "contract", "contract.json")) //nolint:gosec // G304: the committed contract of this checkout.
		if err == nil {
			loaded := &answerContract{byKey: map[string]contractmodel.Route{}, goTypes: map[string]string{}}
			if err := json.Unmarshal(raw, &loaded.doc); err != nil {
				panic("answer contract: " + err.Error())
			}
			for _, route := range loaded.doc.Routes {
				loaded.byKey[route.Key()] = route
			}
			for _, object := range loaded.doc.Types {
				loaded.goTypes[object.Name] = object.GoType
			}
			return loaded
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			// A test binary outside the backend module answers no registered route.
			return &answerContract{}
		}
		dir = parent
	}
})

func observeAnswerContract(r *http.Request, status int, data any, envelope any) error {
	return loadAnswerContract().observe(r, status, data, envelope, recordAnswered)
}

func observeRefusal(r *http.Request) {
	loadAnswerContract().observeRefusal(r, recordAnswered)
}

// RefusedAnswerKey is the line the answers file holds for a refusal of the
// route key: it answers a route that only refuses (RouteContract.Refuses),
// no other.
func RefusedAnswerKey(key string) string { return "refused " + key }

// observeRefusal records a refusal of a route a test identified by its full
// pattern. A route-sized router cannot tell which route refused: an error
// carries no type to narrow the candidates.
func (loaded *answerContract) observeRefusal(r *http.Request, record func(string)) {
	routeContext := chi.RouteContext(r.Context())
	if routeContext == nil {
		return
	}
	pattern := strings.TrimSuffix(routeContext.RoutePattern(), "/")
	for _, route := range loaded.doc.Routes {
		if route.Method == r.Method && strings.TrimSuffix(route.Pattern, "/") == pattern {
			record(RefusedAnswerKey(route.Key()))
			return
		}
	}
}

func (loaded *answerContract) observe(r *http.Request, status int, data any, envelope any, record func(string)) error {
	routeContext := chi.RouteContext(r.Context())
	if len(loaded.byKey) == 0 || routeContext == nil || status >= http.StatusMultipleChoices {
		return nil
	}
	pattern := routeContext.RoutePattern()
	routes, whole := loaded.candidates(r.Method, pattern, data)
	routes, envelope = plainCandidates(routes, envelope)
	if len(routes) == 0 {
		return nil
	}
	var body []byte
	if envelope != nil {
		var err error
		if body, err = wire.Marshal(envelope); err != nil {
			return nil // Respond reports what does not render.
		}
	}
	var reports []string
	if err := untypedBodyError(r, routes, whole); err != nil {
		return err
	}
	for _, route := range routes {
		violations := loaded.doc.Violations(route, contractmodel.Answer{Status: status, Body: body, Variant: variantOf(r, route)})
		if len(violations) == 0 {
			continue
		}
		reports = append(reports, route.Key()+":\n  "+strings.Join(violations, "\n  "))
	}
	// Two portals mount the same handlers; the answer belongs to one of them.
	if len(reports) < len(routes) {
		// A matching schema alone cannot identify which handler ran.
		if len(routes) == 1 {
			record(routes[0].Key())
		}
		return nil
	}
	scope := "a route-sized router"
	if whole {
		scope = "the whole router"
	}
	return fmt.Errorf("the answer of %s %s (%s) leaves the contract in api/contract/contract.json; the BFF would answer 502. Fix the handler, or the registration and run gencontract.\n%s", r.Method, pattern, scope, strings.Join(reports, "\n"))
}

// plainCandidates keeps the routes an answer of RenderJSON may belong to:
// it writes many answers outside the contract, and only a route registered
// as Plain reads one as its data (#7808). The body to check is the value
// itself.
func plainCandidates(routes []contractmodel.Route, envelope any) ([]contractmodel.Route, any) {
	plain, isPlain := envelope.(PlainAnswer)
	if !isPlain {
		return routes, envelope
	}
	return slices.DeleteFunc(routes, func(route contractmodel.Route) bool { return !route.Plain }), plain.Value
}

// untypedBodyError refuses a handler that read a body its route's contract
// does not type. A route-sized router names the route only when one
// registered route fits; then its body is held to the contract as well.
func untypedBodyError(r *http.Request, routes []contractmodel.Route, whole bool) error {
	if (!whole && len(routes) != 1) || !readsAnUntypedBody(r, routes[0]) {
		return nil
	}
	return fmt.Errorf("%s read a request body, but its contract registers no Request type, so no typed client can send it. Name the body type in the route's common.RouteContract and run gencontract", routes[0].Key())
}

// readsAnUntypedBody tells whether the handler read a body the route's
// contract does not type (#7808). A body the handler left unread is a test
// sending more than the route takes, not a gap of the contract.
func readsAnUntypedBody(r *http.Request, route contractmodel.Route) bool {
	if route.Request != nil || route.Multipart || r.ContentLength <= 0 || r.Body == nil {
		return false
	}
	var next [1]byte
	n, _ := r.Body.Read(next[:])
	return n == 0
}

// candidates are the registered routes this answer may belong to: the one
// with the full pattern, or those of the method that end in the pattern and
// answer with the Go type of data. chi reports a pattern without its
// trailing slash.
func (c *answerContract) candidates(method, pattern string, data any) ([]contractmodel.Route, bool) {
	var routes []contractmodel.Route
	for _, route := range c.doc.Routes {
		if route.Method == method && strings.TrimSuffix(route.Pattern, "/") == strings.TrimSuffix(pattern, "/") {
			return []contractmodel.Route{route}, true
		}
		if route.Method == method && mountedAt(route.Pattern, pattern) && c.answersWith(route, data) {
			routes = append(routes, route)
		}
	}
	return routes, false
}

// mountedAt reports whether full is relative below some mount. The root of
// a mount is registered with its trailing slash.
func mountedAt(full, relative string) bool {
	relative = strings.TrimSuffix(relative, "/")
	if relative == "" {
		return strings.HasSuffix(full, "/")
	}
	prefix, found := strings.CutSuffix(strings.TrimSuffix(full, "/"), relative)
	return found && prefix != "" && !strings.HasSuffix(prefix, "}")
}

func (c *answerContract) answersWith(route contractmodel.Route, data any) bool {
	if route.NoData {
		return data == nil
	}
	if data == nil {
		return false
	}
	// A list and a single object of the same type are different answers.
	t, lists := elementType(reflect.TypeOf(data))
	schemas := []contractmodel.Schema{}
	if route.Response != nil {
		schemas = append(schemas, *route.Response)
	}
	if route.Variants != nil {
		for _, schema := range route.Variants.Cases {
			schemas = append(schemas, schema)
		}
	}
	for _, schema := range schemas {
		ref, depth := elementSchema(schema)
		if depth == lists && ref.Kind == contractmodel.KindRef && c.goTypes[ref.Ref] == t.String() {
			return true
		}
	}
	return false
}

// elementType is the type of the elements of t and how many lists hold them.
func elementType(t reflect.Type) (reflect.Type, int) {
	lists := 0
	for t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice || t.Kind() == reflect.Array {
		if t.Kind() != reflect.Pointer {
			lists++
		}
		t = t.Elem()
	}
	return t, lists
}

// elementSchema is the schema of the elements of schema and how many arrays
// hold them.
func elementSchema(schema contractmodel.Schema) (contractmodel.Schema, int) {
	depth := 0
	for schema.Kind == contractmodel.KindArray {
		schema = *schema.Elem
		depth++
	}
	return schema, depth
}

func variantOf(r *http.Request, route contractmodel.Route) string {
	if route.Variants == nil {
		return ""
	}
	return r.URL.Query().Get(route.Variants.QueryParam)
}

var answersFile = sync.OnceValue(func() *os.File {
	name := os.Getenv(answersFileEnv)
	if name == "" {
		return nil
	}
	file, err := os.OpenFile(name, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // G304: the path the developer named.
	if err != nil {
		panic("answer contract: " + err.Error())
	}
	return file
})

func recordAnswered(key string) {
	if file := answersFile(); file != nil {
		_, _ = file.WriteString(key + "\n")
	}
}
