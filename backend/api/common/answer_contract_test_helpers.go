//go:build testhooks

package common

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
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
func init() { answerObserver = observeAnswerContract }

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

func (loaded *answerContract) observe(r *http.Request, status int, data any, envelope any, record func(string)) error {
	routeContext := chi.RouteContext(r.Context())
	if len(loaded.byKey) == 0 || routeContext == nil || status >= http.StatusMultipleChoices {
		return nil
	}
	pattern := routeContext.RoutePattern()
	routes, whole := loaded.candidates(r.Method, pattern, data)
	if len(routes) == 0 {
		return nil
	}
	var body []byte
	if envelope != nil {
		var err error
		if body, err = json.Marshal(envelope); err != nil {
			return nil // Respond reports what does not render.
		}
	}
	var reports []string
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
	t := reflect.TypeOf(data)
	for t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice || t.Kind() == reflect.Array {
		t = t.Elem()
	}
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
		for schema.Kind == contractmodel.KindArray {
			schema = *schema.Elem
		}
		if schema.Kind == contractmodel.KindRef && c.goTypes[schema.Ref] == t.String() {
			return true
		}
	}
	return false
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
