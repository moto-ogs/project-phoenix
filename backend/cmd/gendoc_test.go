package cmd

import (
	"os"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGendocRoutesCLIWorksWithoutDatabase(t *testing.T) {
	t.Parallel()
	path := t.TempDir() + "/routes.md"
	require.NoError(t, genRoutesDocAt(path))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(content), "/api")
}

func TestGenRoutesDocReportsWriteFailure(t *testing.T) {
	t.Parallel()
	path := t.TempDir() + "/routes.md"
	require.NoError(t, os.Mkdir(path, 0755))

	err := genRoutesDocAt(path)
	require.ErrorContains(t, err, "write routes documentation")
}

// =============================================================================
// Command Registration Tests
// =============================================================================

func TestGendocCmd_Metadata(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "gendoc", gendocCmd.Use)
	assert.Contains(t, gendocCmd.Short, "Generate")
	assert.Contains(t, gendocCmd.Long, "OpenAPI")
	assert.NotNil(t, gendocCmd.RunE)
}

func TestGendocCmd_Flags(t *testing.T) {
	t.Parallel()
	f := gendocCmd.Flags()
	assert.NotNil(t, f.Lookup("routes"))
	assert.NotNil(t, f.Lookup("openapi"))
}

// =============================================================================
// createOpenAPIBaseStructure Tests
// =============================================================================

func TestCreateOpenAPIBaseStructure(t *testing.T) {
	t.Parallel()
	spec := createOpenAPIBaseStructure()

	assert.Equal(t, "3.0.3", spec["openapi"])

	info, ok := spec["info"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "MOTO API", info["title"])
	assert.Equal(t, "1.0.0", info["version"])
	assert.Contains(t, info["description"].(string), "MOTO")

	contact, ok := info["contact"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "MOTO Support", contact["name"])

	servers, ok := spec["servers"].([]map[string]interface{})
	require.True(t, ok)
	require.Len(t, servers, 1)
	assert.Equal(t, "/api", servers[0]["url"])

	components, ok := spec["components"].(map[string]interface{})
	require.True(t, ok)

	securitySchemes, ok := components["securitySchemes"].(map[string]interface{})
	require.True(t, ok)
	assert.Contains(t, securitySchemes, "bearerAuth")
	assert.Contains(t, securitySchemes, "apiKeyAuth")

	schemas, ok := components["schemas"].(map[string]interface{})
	require.True(t, ok)
	assert.NotNil(t, schemas)

	paths, ok := spec["paths"].(map[string]interface{})
	require.True(t, ok)
	assert.NotNil(t, paths)
}

// =============================================================================
// extractPathParams Tests
// =============================================================================

func TestExtractPathParams_SingleParam(t *testing.T) {
	t.Parallel()
	params := extractPathParams("/users/{id}")
	assert.Equal(t, []string{"id"}, params)
}

func TestExtractPathParams_MultipleParams(t *testing.T) {
	t.Parallel()
	params := extractPathParams("/users/{userId}/posts/{postId}")
	assert.Equal(t, []string{"userId", "postId"}, params)
}

func TestExtractPathParams_NoParams(t *testing.T) {
	t.Parallel()
	params := extractPathParams("/api/students")
	assert.Nil(t, params)
}

func TestExtractPathParams_EmptyPath(t *testing.T) {
	t.Parallel()
	params := extractPathParams("")
	assert.Nil(t, params)
}

func TestExtractPathParams_ComplexPath(t *testing.T) {
	t.Parallel()
	params := extractPathParams("/api/{version}/groups/{groupId}/students/{studentId}")
	assert.Equal(t, []string{"version", "groupId", "studentId"}, params)
}

// =============================================================================
// getTagsFromPath Tests
// =============================================================================

func TestGetTagsFromPath_SimpleAPI(t *testing.T) {
	t.Parallel()
	tags := getTagsFromPath("/api/students")
	assert.Equal(t, []string{"Students"}, tags)
}

func TestGetTagsFromPath_NestedPath(t *testing.T) {
	t.Parallel()
	tags := getTagsFromPath("/api/groups/123/students")
	assert.Equal(t, []string{"Groups"}, tags)
}

func TestGetTagsFromPath_IoTPath(t *testing.T) {
	t.Parallel()
	tags := getTagsFromPath("/api/iot/devices")
	assert.Equal(t, []string{"Iot"}, tags)
}

func TestGetTagsFromPath_RootPath(t *testing.T) {
	t.Parallel()
	tags := getTagsFromPath("/")
	assert.Equal(t, []string{"API"}, tags)
}

func TestGetTagsFromPath_EmptyPath(t *testing.T) {
	t.Parallel()
	tags := getTagsFromPath("")
	assert.Equal(t, []string{"API"}, tags)
}

func TestGetTagsFromPath_APIOnly(t *testing.T) {
	t.Parallel()
	// /api with nothing after should fall through to "API" default
	tags := getTagsFromPath("/api")
	assert.Equal(t, []string{"API"}, tags)
}

func TestGetTagsFromPath_NonAPIPrefix(t *testing.T) {
	t.Parallel()
	tags := getTagsFromPath("/health")
	assert.Equal(t, []string{"Health"}, tags)
}

// =============================================================================
// getSettingsSchemas Tests
// =============================================================================

func TestGetSettingsSchemas(t *testing.T) {
	t.Parallel()
	schemas := getSettingsSchemas()

	assert.Contains(t, schemas, "Setting")
	assert.Contains(t, schemas, "SettingRequest")

	setting, ok := schemas["Setting"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "object", setting["type"])

	props, ok := setting["properties"].(map[string]interface{})
	require.True(t, ok)
	assert.Contains(t, props, "id")
	assert.Contains(t, props, "key")
	assert.Contains(t, props, "value")
	assert.Contains(t, props, "category")
	assert.Contains(t, props, "description")
	assert.Contains(t, props, "requires_restart")
	assert.Contains(t, props, "requires_db_reset")
	assert.Contains(t, props, "created_at")
	assert.Contains(t, props, "modified_at")

	required, ok := setting["required"].([]string)
	require.True(t, ok)
	assert.Contains(t, required, "id")
	assert.Contains(t, required, "key")
	assert.Contains(t, required, "value")
	assert.Contains(t, required, "category")

	settingReq, ok := schemas["SettingRequest"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "object", settingReq["type"])

	reqProps, ok := settingReq["properties"].(map[string]interface{})
	require.True(t, ok)
	assert.Contains(t, reqProps, "key")
	assert.Contains(t, reqProps, "value")
	assert.Contains(t, reqProps, "category")

	reqRequired, ok := settingReq["required"].([]string)
	require.True(t, ok)
	assert.Contains(t, reqRequired, "key")
	assert.Contains(t, reqRequired, "value")
	assert.Contains(t, reqRequired, "category")
}

func TestCatalogOpenAPISpecGroupsOperationsByRoute(t *testing.T) {
	t.Parallel()
	const path = "/api/groups/{groupId}/students/{studentId}"
	spec := catalogOpenAPISpec([]api.Route{
		{Method: "GET", Pattern: path},
		{Method: "POST", Pattern: path},
		{Method: "PUT", Pattern: path},
		{Method: "DELETE", Pattern: path},
		{Method: "PATCH", Pattern: path},
		{Method: "HEAD", Pattern: "/health"},
	})

	paths := spec["paths"].(map[string]interface{})
	require.Len(t, paths, 2)
	operations := paths[path].(map[string]interface{})
	require.Len(t, operations, 5)
	for _, method := range []string{"get", "post", "put", "delete", "patch"} {
		assert.Contains(t, operations, method)
	}
	assert.Empty(t, paths["/health"])

	read := operations["get"].(map[string]interface{})
	assert.Equal(t, "GET "+path, read["summary"])
	assert.Equal(t, []string{"Groups"}, read["tags"])
	params := read["parameters"].([]map[string]interface{})
	require.Len(t, params, 2)
	assert.Equal(t, "groupId", params[0]["name"])
	assert.Equal(t, "studentId", params[1]["name"])
	for _, param := range params {
		assert.Equal(t, "path", param["in"])
		assert.Equal(t, true, param["required"])
	}

	components := spec["components"].(map[string]interface{})
	schemas := components["schemas"].(map[string]interface{})
	assert.Contains(t, schemas, "Setting")
	assert.Contains(t, schemas, "SettingRequest")
}
