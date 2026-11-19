package api

import (
	"io/fs"
	"os"
	"path/filepath"
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
	for _, route := range doc.Routes {
		chain, known := chains[route.Key()]
		require.Truef(t, known, "%s has no middleware golden", route.Key())
		// One scope middleware admits one portal; a route for two portals
		// needs a deliberate decision here first.
		require.Lenf(t, route.Portals, 1, "%s names more than one portal", route.Key())
		scope, mapped := portalScopeMiddleware[common.PortalScope(route.Portals[0])]
		require.Truef(t, mapped, "%s: portal %q has no scope middleware in portalScopeMiddleware", route.Key(), route.Portals[0])
		assert.Containsf(t, strings.Split(chain, " > "), scope, "%s is registered for portal %q but does not run behind %s", route.Key(), route.Portals[0], scope)
	}
}
