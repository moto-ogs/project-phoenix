package api

import (
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// routesNoRouterTestAnswers are the registered routes no test answers
// through a router, so the answer check (api/common/answer_contract_test_helpers.go)
// never holds a real answer of theirs against the contract. Their tests call
// the handler without a router, or none exists. Their types still render
// within the contract (TestRegisteredResponseTypesRenderWithinTheContract).
//
// Shrink only: give the route a test through its router and delete the line.
var routesNoRouterTestAnswers = map[string]string{
	"DELETE /api/notifications/push/subscriptions":                   "handler test without a router",
	"DELETE /school/notifications/push/subscriptions":                "handler test without a router",
	"GET /api/notifications/push/public-key":                         "handler test without a router",
	"GET /school/notifications/push/public-key":                      "handler test without a router",
	"POST /api/notifications/push/subscriptions":                     "handler test without a router",
	"POST /school/notifications/push/subscriptions":                  "handler test without a router",
	"GET /operator/billing/key-day":                                  "handler test without a router",
	"PUT /operator/billing/key-day":                                  "handler test without a router",
	"GET /parent/me/enrollable-schools":                              "no test answers the route",
	"GET /school/parent-letters/letter-placeholders":                 "no test answers the route",
	"POST /school/parent-letters/letter-preview":                     "no test answers the route",
	"POST /school/supervisions/{id}/complete":                        "only the staff portal's route is tested",
	"POST /school/supervisions/{id}/students/{student_id}/check-out": "only the staff portal's route is tested",
}

// The answer check writes the key of every registered route a test answered
// to the file CONTRACT_ANSWERS_FILE names. After a run of the whole suite
// this test holds that file against the register above:
//
//	cd backend && rm -f /tmp/answers.txt
//	CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh ../scripts/test-backend.sh
//	CONTRACT_ANSWERS_FILE=/tmp/answers.txt ../scripts/run-go-toolchain.sh go test -tags=testhooks ./api -run TestEveryRegisteredRouteIsAnsweredInATest -count=1
//
// A selection of packages answers fewer routes, so the comparison runs only
// on request. The register itself is checked on every run.
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

	name := os.Getenv("CONTRACT_ANSWERS_FILE")
	if name == "" {
		// Only the register is checked: one package answers few routes.
		return
	}
	raw, err := os.ReadFile(name) //nolint:gosec // G304: the file the developer named.
	require.NoError(t, err)
	answered := map[string]bool{}
	for _, key := range strings.Split(string(raw), "\n") {
		answered[key] = true
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
	assert.Emptyf(t, unanswered, "no test answers these registered routes through a router, so nothing holds their real answers against the contract. Add a test that drives the route's router:\n%s", strings.Join(unanswered, "\n"))
	assert.Emptyf(t, stale, "a test answers these routes now; delete their lines from routesNoRouterTestAnswers:\n%s", strings.Join(stale, "\n"))
}
