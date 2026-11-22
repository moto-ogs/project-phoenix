package api

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var outsideReasons = map[outsideReason]bool{
	outsideDevice: true, outsideWebDAV: true, outsideMetrics: true, outsideProbe: true, outsideSession: true,
	outsideStream: true, outsidePublicAPI: true, outsideWebhook: true, outsideBrowserRoute: true,
}

// matches reports whether an entry names a catalog route.
func (r outsideRoute) matches(method, pattern string) bool {
	if r.prefix {
		return strings.HasPrefix(pattern, r.line)
	}
	return r.line == method+" "+pattern
}

// TestEveryCatalogRouteHasAContractOrAReason holds the catalog to one
// pattern: a route registers a contract, or routesOutsideContract names
// why it cannot (#7808).
func TestEveryCatalogRouteHasAContractOrAReason(t *testing.T) {
	t.Parallel()
	catalog, err := RouteCatalog()
	require.NoError(t, err)
	registrations, err := contractRegistrations()
	require.NoError(t, err)
	registered := map[string]bool{}
	for _, registration := range registrations {
		registered[registration.Method+" "+registration.Pattern] = true
	}
	isRegistered := func(method, pattern string) bool {
		return registered[method+" "+pattern] || registered[method+" "+strings.ReplaceAll(pattern, "/*/", "/")]
	}

	entries := routesOutsideContract()
	used := make([]int, len(entries))
	for _, route := range catalog {
		line := route.Method + " " + route.Pattern
		if isRegistered(route.Method, route.Pattern) {
			// A prefix covers only the routes without a contract below it.
			for _, entry := range entries {
				assert.False(t, !entry.prefix && entry.matches(route.Method, route.Pattern),
					"%s registers a contract; remove it from routesOutsideContract", line)
			}
			continue
		}
		var hits []string
		for i, entry := range entries {
			if entry.matches(route.Method, route.Pattern) {
				used[i]++
				hits = append(hits, entry.line)
			}
		}
		assert.Len(t, hits, 1, "%s: register a common.RouteContract (docs/agents/new-route.md), or name exactly one reason in routesOutsideContract", line)
	}
	for i, entry := range entries {
		assert.Positive(t, used[i], "%q names no route of the catalog; remove it", entry.line)
		assert.True(t, outsideReasons[entry.reason], "%q: unknown reason %q", entry.line, entry.reason)
		assert.NotEmpty(t, strings.TrimSpace(entry.why), "%q: say why the contract cannot carry it", entry.line)
	}
}
