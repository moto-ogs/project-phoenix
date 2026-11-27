package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/contract"
)

// The answer check writes the key of every registered route a test identified
// unambiguously and answered to the file CONTRACT_ANSWERS_FILE names. After a
// run of the whole suite, CONTRACT_ANSWERS_CHECK=1 makes this test hold that
// file against every registered JSON route; there is no exception list
// (#7808):
//
//	cd backend && rm -f /tmp/answers.txt
//	CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh ../scripts/test-backend.sh -count=1 ./...
//	CONTRACT_ANSWERS_CHECK=1 CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh go test -tags=testhooks ./api -run TestEveryRegisteredRouteIsAnsweredInATest -count=1
//
// A selection of packages answers fewer routes. CI's backend job runs the
// check after every run that tested ./api: the whole suite holds every route,
// a selection with CONTRACT_ANSWERS_BASE (the base branch's contract.json)
// only the routes the branch adds.
//
// A file route answers bytes, not the envelope: no decoder reads it, so no
// answer of it can leave the contract, and it needs none here.
// Collection never reads the file while other packages may still write it.
// CI writes the sorted expected keys to CONTRACT_ANSWERS_REQUIRED here, then
// compares the files after every package finishes, without rerunning ./api.
// Ambiguous relative patterns validate schemas but do not count as
// coverage; mount those test routers explicitly to identify their routes.
func TestEveryRegisteredRouteIsAnsweredInATest(t *testing.T) {
	t.Parallel()
	doc, err := ContractDocument()
	require.NoError(t, err)
	answered, err := readRouteAnswers(os.Getenv)
	require.NoError(t, err)
	requiredFile := os.Getenv("CONTRACT_ANSWERS_REQUIRED")
	if answered == nil && requiredFile == "" {
		return
	}
	existing, err := readBaseRoutes(os.Getenv)
	require.NoError(t, err)
	var unanswered []string
	for _, route := range doc.Routes {
		key := route.Key()
		if !route.File && !answered[key] && !existing[key] {
			unanswered = append(unanswered, key)
		}
	}
	sort.Strings(unanswered)
	if answered == nil {
		var lines strings.Builder
		for _, key := range unanswered {
			lines.WriteString(key)
			lines.WriteByte('\n')
		}
		require.NoError(t, os.WriteFile(requiredFile, []byte(lines.String()), 0o600))
		return
	}
	assert.Emptyf(t, unanswered, "no test unambiguously answers these registered routes through a router. Mount the route's router explicitly in a test, under the route's full path:\n%s", strings.Join(unanswered, "\n"))
}

func readRouteAnswers(getenv func(string) string) (map[string]bool, error) {
	if getenv("CONTRACT_ANSWERS_CHECK") != "1" {
		return nil, nil
	}
	name := getenv("CONTRACT_ANSWERS_FILE")
	if name == "" {
		return nil, fmt.Errorf("CONTRACT_ANSWERS_CHECK=1 requires CONTRACT_ANSWERS_FILE")
	}
	raw, err := os.ReadFile(name) //nolint:gosec // G304: the file the developer named.
	if err != nil {
		return nil, err
	}
	answered := map[string]bool{}
	for _, key := range strings.Split(string(raw), "\n") {
		answered[key] = true
	}
	return answered, nil
}

// readBaseRoutes are the routes of the base branch's contract, which a run of
// a package selection does not hold to an answer; nil holds every route.
func readBaseRoutes(getenv func(string) string) (map[string]bool, error) {
	name := getenv("CONTRACT_ANSWERS_BASE")
	if name == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(name) //nolint:gosec // G304: the file CI named.
	if err != nil {
		return nil, err
	}
	var base contract.Document
	if err := json.Unmarshal(raw, &base); err != nil {
		return nil, fmt.Errorf("base contract %s: %w", name, err)
	}
	routes := map[string]bool{}
	for _, route := range base.Routes {
		routes[route.Key()] = true
	}
	return routes, nil
}

func TestRouteAnswerCoverageCollectionAndCheckAreSeparate(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name       string
		check      string
		noFilename bool
		contents   string
		want       map[string]bool
		wantError  string
	}{
		{name: "collection does not read the file"},
		{name: "check requires a filename", check: "1", noFilename: true, wantError: "requires CONTRACT_ANSWERS_FILE"},
		{name: "check requires a file", check: "1", wantError: "no such file or directory"},
		{name: "check reads collected routes", check: "1", contents: "DELETE /traeger/documents/{id}", want: map[string]bool{"DELETE /traeger/documents/{id}": true}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			name := filepath.Join(t.TempDir(), "answers.txt")
			if tt.noFilename {
				name = ""
			}
			if tt.contents != "" {
				require.NoError(t, os.WriteFile(name, []byte(tt.contents), 0o600))
			}
			env := map[string]string{"CONTRACT_ANSWERS_FILE": name, "CONTRACT_ANSWERS_CHECK": tt.check}
			answered, err := readRouteAnswers(func(key string) string { return env[key] })
			if tt.wantError != "" {
				require.ErrorContains(t, err, tt.wantError)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, answered)
		})
	}
}

func TestRouteAnswerCoverageOfASelectionSparesTheBaseRoutes(t *testing.T) {
	t.Parallel()
	none, err := readBaseRoutes(func(string) string { return "" })
	require.NoError(t, err)
	assert.Nil(t, none, "without a base every route needs an answer")

	name := filepath.Join(t.TempDir(), "contract.json")
	require.NoError(t, os.WriteFile(name, []byte(`{"routes":[{"method":"GET","pattern":"/traeger/documents/","portals":["org"]}]}`), 0o600))
	base, err := readBaseRoutes(func(key string) string {
		return map[string]string{"CONTRACT_ANSWERS_BASE": name}[key]
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]bool{"GET /traeger/documents/": true}, base)
}
