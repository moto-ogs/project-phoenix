package api

import (
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// portalScopeMiddleware names the middleware that admits only the session
// tokens of a portal. A portal's proxy forwards every route registered for
// it, so a registration may name a portal only when the route runs behind
// that portal's middleware.
var portalScopeMiddleware = map[common.PortalScope]string{
	common.PortalTenant:   "api.TenantScopeMiddleware",
	common.PortalParent:   "api.ParentScopeMiddleware",
	common.PortalSchool:   "api.SchoolScopeMiddleware",
	common.PortalTraeger:  "api.TraegerScopeMiddleware",
	common.PortalCaterer:  "api.CatererScopeMiddleware",
	common.PortalOperator: "modules/identityaccess/inbound/operator.RequiresOperatorScope",
}

// sharedPortalRoutes are the routes the root mounts beside every portal
// (#2352, decision 3): each serves several portals and has no portal's
// scope middleware. Each names its portals and the middleware that bounds it
// instead; the handler refuses the sessions the reason names.
var sharedPortalRoutes = map[string]struct {
	portals    []string
	middleware string
	reason     string
}{
	"GET /analytics-consent/": {
		[]string{"parent", "school", "tenant"}, "modules/identityaccess/sessiontoken.Authenticator",
		"the account's own consent; the resource refuses operator, Träger and preview sessions (me.ownAccount)",
	},
	"PUT /analytics-consent/": {
		[]string{"parent", "school", "tenant"}, "modules/identityaccess/sessiontoken.Authenticator",
		"the account's own consent; the resource refuses operator, Träger and preview sessions (me.ownAccount)",
	},
	"GET /display-preferences/": {
		[]string{"caterer", "org", "parent", "platform", "school", "tenant"}, "modules/identityaccess/sessiontoken.Authenticator",
		"the person's own display preference; platform sessions read the operator, every other session its account; the resource refuses preview sessions (me.ownHolder)",
	},
	"PUT /display-preferences/": {
		[]string{"caterer", "org", "parent", "platform", "school", "tenant"}, "modules/identityaccess/sessiontoken.Authenticator",
		"the person's own display preference; platform sessions write the operator, every other session its account; the resource refuses preview sessions (me.ownHolder)",
	},
	"GET /analytics-policy": {
		[]string{"parent", "school"}, "modules/identityaccess/sessiontoken.ParseVerified",
		"only a boolean from the verified session; without a portal session it answers off",
	},
}

// The middleware goldens are the reviewed chain of every route;
// TestFullProductionRouterGolden holds them against the real router.
func TestARegisteredRouteRunsBehindTheScopeOfItsOnePortal(t *testing.T) {
	t.Parallel()
	chains := map[string]string{}
	require.NoError(t, filepath.WalkDir(filepath.Join("testdata", "middleware"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		golden, err := os.ReadFile(path) //nolint:gosec // G304: test fixture below testdata.
		if err != nil {
			return err
		}
		for _, line := range strings.Split(strings.TrimSpace(expandMiddlewareTable(t, string(golden))), "\n") {
			if route, chain, ok := strings.Cut(line, " -> "); ok {
				chains[route] = chain
				// A router mounted at "/" is registered as its request reports it.
				chains[strings.ReplaceAll(route, "/*/", "/")] = chain
			}
		}
		return nil
	}))

	doc, err := ContractDocument()
	require.NoError(t, err)
	require.NotEmpty(t, doc.Routes)
	registered := map[string]bool{}
	for _, route := range doc.Routes {
		registered[route.Key()] = true
	}
	for key := range sharedPortalRoutes {
		assert.Truef(t, registered[key], "sharedPortalRoutes names %s, which the contract no longer registers", key)
	}
	conditionalDemoRoutes := appendDemoCatalogRoutes(t, nil)
	for _, route := range doc.Routes {
		chain, known := chains[route.Key()]
		// The production router does not mount the demo. Its portal route
		// files are checked against the conditional catalog instead.
		if !known && route.RouteFile != "" && slices.Contains(conditionalDemoRoutes, route.Key()) {
			continue
		}
		require.Truef(t, known, "%s has no middleware golden", route.Key())
		if route.RouteFile != "" {
			// No proxy forwards a route file's route (#7808): a sign-in step
			// runs before any session, and the route file decides what it
			// sends.
			continue
		}
		if shared, ok := sharedPortalRoutes[route.Key()]; ok {
			assert.Equalf(t, shared.portals, route.Portals, "%s: the shared route's portals changed; review %q", route.Key(), shared.reason)
			assert.Containsf(t, strings.Split(chain, " > "), shared.middleware, "%s no longer runs behind %s", route.Key(), shared.middleware)
			continue
		}
		// One scope middleware admits one portal; a route for two portals
		// needs a deliberate decision here first.
		require.Lenf(t, route.Portals, 1, "%s names more than one portal", route.Key())
		if common.PortalScope(route.Portals[0]) == common.PortalPublic {
			assertRunsWithoutSession(t, route.Key(), strings.Split(chain, " > "))
			continue
		}
		scope, mapped := portalScopeMiddleware[common.PortalScope(route.Portals[0])]
		require.Truef(t, mapped, "%s: portal %q has no scope middleware in portalScopeMiddleware", route.Key(), route.Portals[0])
		assert.Containsf(t, strings.Split(chain, " > "), scope, "%s is registered for portal %q but does not run behind %s", route.Key(), route.Portals[0], scope)
	}
}

// sessionAuthenticator rejects a request without a session token.
const sessionAuthenticator = "modules/identityaccess/sessiontoken.Authenticator"

// assertRunsWithoutSession holds a public route to a chain that admits a
// request without a session: the public proxy path sends no bearer, so a
// scope middleware or the authenticator would refuse every call (#2352).
func assertRunsWithoutSession(t *testing.T, key string, chain []string) {
	t.Helper()
	assert.NotContainsf(t, chain, sessionAuthenticator, "%s is registered as public but runs behind %s", key, sessionAuthenticator)
	for portal, scope := range portalScopeMiddleware {
		assert.NotContainsf(t, chain, scope, "%s is registered as public but runs behind the %s scope %s", key, portal, scope)
	}
}
