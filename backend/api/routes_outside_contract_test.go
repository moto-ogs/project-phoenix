package api

import (
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
)

// TestEveryCatalogRouteHasAContractOrAReason holds the catalog to one way
// (#7808): every line is a route the portals' catalog proxy serves, a route
// a portal's own route file serves (RouteFile), or a line outside the
// contract with a reason of the closed set (Outside), and exactly one of
// them. Each marker sits on the line's common.RouteContract.
func TestEveryCatalogRouteHasAContractOrAReason(t *testing.T) {
	t.Parallel()
	catalog, err := RouteCatalog()
	require.NoError(t, err)
	doc, err := ContractDocument()
	require.NoError(t, err)

	kinds := map[string][]string{}
	for _, route := range doc.Routes {
		kind := "proxied contract"
		if route.RouteFile != "" {
			kind = "route file contract"
			assert.NotEmpty(t, strings.TrimSpace(route.RouteFile), "%s: say why its route file serves it", route.Key())
		}
		kinds[route.Key()] = append(kinds[route.Key()], kind)
	}
	for _, line := range doc.Outside {
		kinds[line.Key()] = append(kinds[line.Key()], "outside")
		assert.Contains(t, contractmodel.OutsideReasons, line.Reason, "%s: unknown reason", line.Key())
		assert.NotEmpty(t, strings.TrimSpace(line.Why), "%s: say why the contract cannot carry it", line.Key())
	}
	for _, route := range catalog {
		line := route.Method + " " + route.Pattern
		// A router mounted at "/" shows as "/*/" in the catalog; a
		// registration names the pattern without it.
		found := slices.Concat(kinds[line], kinds[strings.ReplaceAll(line, "/*/", "/")])
		if line == strings.ReplaceAll(line, "/*/", "/") {
			found = kinds[line]
		}
		assert.Len(t, found, 1, "%s: register a common.RouteContract beside its handler (docs/agents/new-route.md): a proxied contract, a RouteFile contract, or Outside with its reason; found %v", line, found)
	}
}
