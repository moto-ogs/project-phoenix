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

// routesNoRouterTestAnswers are the registered routes without unambiguous
// router answers, so the answer check (api/common/answer_contract_test_helpers.go)
// cannot attribute a real answer to them. Their tests call the handler without
// a router, use an ambiguous router, or none exists. Their types still render
// within the contract (TestRegisteredResponseTypesRenderWithinTheContract).
// Measured with a full suite on 2026-11-20 (#7563).
//
// Shrink only: give the route a test through its router and delete the line.
var routesNoRouterTestAnswers = map[string]string{
	"DELETE /caterer/auth/passkeys/{passkeyId}":                        "no router test answers it",
	"DELETE /operator/auth/mfa/trusted-devices/{deviceId}":             "no router test answers it",
	"DELETE /operator/auth/passkeys/{passkeyId}":                       "no router test answers it",
	"DELETE /traeger/holiday-periods/{id}/form/documents/{documentId}": "no router test answers it",
	"GET /auth/invitations/{token}":                                    "no router test answers it",
	"POST /auth/guardian-invitations/{token}/accept":                   "no router test answers it",
	"POST /caterer/account/mfa/disable":                                "no router test answers it",
	"POST /caterer/auth/passkeys/enrollment/challenge":                 "no router test answers it",
	"POST /caterer/auth/passkeys/register/options":                     "no router test answers it",
	"POST /caterer/auth/passkeys/register/verify":                      "no router test answers it",
	"POST /caterer/auth/password-reset":                                "no router test answers it",
	"POST /caterer/auth/password-reset/confirm":                        "no router test answers it",
	"POST /operator/auth/email-confirm":                                "no router test answers it",
	"POST /operator/auth/passkeys/enrollment/challenge":                "no router test answers it",
	"POST /operator/auth/passkeys/register/options":                    "no router test answers it",
	"POST /operator/auth/passkeys/register/verify":                     "no router test answers it",
	"POST /operator/profile/password":                                  "no router test answers it",
	"POST /parent/auth/password-reset":                                 "no router test answers it",
	"POST /parent/auth/password-reset/confirm":                         "no router test answers it",
	"POST /parent/me/mfa/disable":                                      "no router test answers it",
	"POST /school/auth/password-reset":                                 "no router test answers it",
	"POST /school/auth/password-reset/confirm":                         "no router test answers it",
	"POST /traeger/contracts/{id}/paper-signature":                     "its handler answers 204 without common.Respond",
}

// The answer check writes the key of every registered route a test identified
// unambiguously and answered to the file CONTRACT_ANSWERS_FILE names. After a
// run of the whole suite, CONTRACT_ANSWERS_CHECK=1 makes this test hold that
// file against the register above:
//
//	cd backend && rm -f /tmp/answers.txt
//	CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh ../scripts/test-backend.sh -count=1 ./...
//	CONTRACT_ANSWERS_CHECK=1 CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh go test -tags=testhooks ./api -run TestEveryRegisteredRouteIsAnsweredInATest -count=1
//
// A selection of packages answers fewer routes. CI's backend job runs the
// check after every run that tested ./api: the whole suite holds every route,
// a selection with CONTRACT_ANSWERS_BASE (the base branch's contract.json)
// only the routes the branch adds. Both find a register line a test answers.
//
// A file route answers bytes, not the envelope: no decoder reads it, so no
// answer of it can leave the contract, and it needs none here.
// Collection never reads the file while other packages may still write it.
// Ambiguous relative patterns validate schemas but do not count as
// coverage; mount those test routers explicitly to identify their routes.
// The register itself is checked on every run.
func TestEveryRegisteredRouteIsAnsweredInATest(t *testing.T) {
	t.Parallel()
	doc, err := ContractDocument()
	require.NoError(t, err)
	registered := map[string]bool{}
	for _, route := range doc.Routes {
		if !route.File {
			registered[route.Key()] = true
		}
	}
	for key := range routesNoRouterTestAnswers {
		assert.Truef(t, registered[key], "%s is not a registered route answering JSON; delete its line", key)
	}

	answered, err := readRouteAnswers(os.Getenv)
	require.NoError(t, err)
	if answered == nil {
		// Only the register is checked: one package answers few routes.
		return
	}
	existing, err := readBaseRoutes(os.Getenv)
	require.NoError(t, err)
	var unanswered, stale []string
	for key := range registered {
		_, excused := routesNoRouterTestAnswers[key]
		switch {
		case !answered[key] && !excused && !existing[key]:
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
