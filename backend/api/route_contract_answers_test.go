package api

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// routesNoRouterTestAnswers are the registered routes without unambiguous
// router answers, so the answer check (api/common/answer_contract_test_helpers.go)
// cannot attribute a real answer to them. Their tests call the handler without
// a router, use an ambiguous router, or none exists. Their types still render
// within the contract (TestRegisteredResponseTypesRenderWithinTheContract).
//
// Shrink only: give the route a test through its router and delete the line.
var routesNoRouterTestAnswers = map[string]string{}

// The answer check writes the key of every registered route a test identified
// unambiguously and answered to the file CONTRACT_ANSWERS_FILE names. After a
// run of the whole suite, CONTRACT_ANSWERS_CHECK=1 makes this test hold that
// file against the register above:
//
//	cd backend && rm -f /tmp/answers.txt
//	CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh ../scripts/test-backend.sh -count=1 ./...
//	CONTRACT_ANSWERS_CHECK=1 CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh go test -tags=testhooks ./api -run TestEveryRegisteredRouteIsAnsweredInATest -count=1
//
// Collection never reads the file while other packages may still write it.
// A selection of packages answers fewer routes, so the comparison runs only
// on request. Ambiguous relative patterns validate schemas but do not count as
// coverage; mount those test routers explicitly to identify their routes.
// The register itself is checked on every run.
func TestEveryRegisteredRouteIsAnsweredInATest(t *testing.T) {
	t.Parallel()
	doc, err := ContractDocument()
	require.NoError(t, err)
	registered := map[string]bool{}
	for _, route := range doc.Routes {
		registered[route.Key()] = true
	}
	for key := range routesNoRouterTestAnswers {
		assert.Truef(t, registered[key], "%s is not a registered route; delete its line", key)
	}

	answered, err := readRouteAnswers(os.Getenv)
	require.NoError(t, err)
	if answered == nil {
		// Only the register is checked: one package answers few routes.
		return
	}
	var unanswered, stale []string
	for key := range registered {
		_, excused := routesNoRouterTestAnswers[key]
		switch {
		case !answered[key] && !excused:
			unanswered = append(unanswered, key)
		case answered[key] && excused:
			stale = append(stale, key)
		}
	}
	sort.Strings(unanswered)
	sort.Strings(stale)
	assert.Emptyf(t, unanswered, "no test unambiguously answers these registered routes through a router. Mount the route's router explicitly in a test:\n%s", strings.Join(unanswered, "\n"))
	assert.Emptyf(t, stale, "a test answers these routes now; delete their lines from routesNoRouterTestAnswers:\n%s", strings.Join(stale, "\n"))
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
