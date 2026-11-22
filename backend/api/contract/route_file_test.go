package contract

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
)

func outsideLine(pattern string) Registration {
	return Registration{Method: "GET", Pattern: pattern, Outside: &OutsideSpec{Reason: contractmodel.OutsideProbe, Why: "liveness probe"}}
}

func routeFile(response any) Registration {
	route := post(body{})
	route.Pattern = "/auth/login"
	route.Response = response
	route.RouteFile = "the route file installs the session cookie"
	return route
}

// A line outside the contract lands in the model's outside list with its
// reason, never among the routes or in a generated file (#7808).
func TestALineOutsideTheContractKeepsItsReason(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{outsideLine("/health"), get("/api/rows/", inner{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	assert.Equal(t, []Outside{{Method: "GET", Pattern: "/health", Reason: "probe", Why: "liveness probe"}}, doc.Outside)
	require.Len(t, doc.Routes, 1)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	for name, source := range files {
		assert.NotContains(t, source, "/health", name)
	}
}

// A route file's route is typed like any route and stands in
// routeFileRoutes, never in the proxy's allowlist (#7808).
func TestARouteFileRouteIsTypedAndNeverProxied(t *testing.T) {
	t.Parallel()
	login := routeFile(inner{})
	login.Plain = true
	doc, err := Build([]Registration{login, get("/auth/tenants", inner{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	encoded, err := json.Marshal(doc.Routes)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"route_file":"the route file installs the session cookie","plain":true`)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["auth-login.generated.ts"]
	assert.Contains(t, source, "    routeFile: \"the route file installs the session cookie\",\n    plain: true,\n")
	assert.Contains(t, source, "    response: innerSchema,\n")
	assert.NotContains(t, source, "success")
	table := files["portals.generated.ts"]
	assert.Contains(t, table, "export const portalRoutes = {\n  tenant: [\n    authTenants[\"GET /auth/tenants\"],\n  ],\n} as const;")
	assert.Contains(t, table, "export const routeFileRoutes = {\n  tenant: [\n    authLogin[\"POST /auth/login\"],\n  ],\n} as const;")
}

func TestBuildRejectsARouteMarkerOutOfPlace(t *testing.T) {
	t.Parallel()
	unknownReason := outsideLine("/health")
	unknownReason.Outside.Reason = "session"
	noWhy := outsideLine("/health")
	noWhy.Outside.Why = " "
	typed := outsideLine("/health")
	typed.Portals = []string{"tenant"}
	twice := get("/health", inner{})
	plainProxied := get("/api/rows/", inner{})
	plainProxied.Plain = true
	blank := routeFile(inner{})
	blank.RouteFile = " "
	public := routeFile(inner{})
	public.Portals = []string{PublicPortal}
	public.MaxBodyBytes = 1024
	proxyTrait := routeFile(inner{})
	proxyTrait.NoRetryAfterRenewal = "mails a code"
	plainWithoutData := routeFile(nil)
	plainWithoutData.NoData = true
	plainWithoutData.Plain = true
	for name, tc := range map[string]struct {
		routes  []Registration
		message string
	}{
		"an unknown reason":                   {[]Registration{unknownReason}, `"session" is no reason`},
		"a reason without why":                {[]Registration{noWhy}, "say in one sentence why"},
		"an outside line with a portal":       {[]Registration{typed}, "names a portal, a type or a trait"},
		"a line outside and registered":       {[]Registration{outsideLine("/health"), twice}, "registered twice"},
		"a plain answer the proxy would read": {[]Registration{plainProxied}, "only a route file reads an answer without the envelope"},
		"a route file without its reason":     {[]Registration{blank}, "RouteFile says why"},
		"a route file of the public portal":   {[]Registration{public}, "names the portal whose route file calls it"},
		"a route file with a proxy trait":     {[]Registration{proxyTrait}, "drop its proxy traits"},
		"a plain answer without a response":   {[]Registration{plainWithoutData}, "a plain answer is one registered response"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := Build(tc.routes, Options{Identifiers: identifiers})
			assert.ErrorContains(t, err, tc.message)
		})
	}
}
