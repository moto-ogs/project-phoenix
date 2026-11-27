package cmd

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/moto-ogs/project-phoenix/api"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

var (
	routes  bool
	openapi bool
)

// gendocCmd represents the gendoc command
var gendocCmd = &cobra.Command{
	Use:   "gendoc",
	Short: "Generate project documentation",
	Long: `Generate documentation for the MOTO server API.

This command can generate:
- API routes markdown documentation
- OpenAPI specification (compatible with Swagger)

Use the appropriate flags to generate the desired documentation.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if routes || !openapi {
			if err := genRoutesDocAt("routes.md"); err != nil {
				return err
			}
		}
		if openapi || !routes {
			return genOpenAPIDoc()
		}
		return nil
	},
}

func init() {
	RootCmd.AddCommand(gendocCmd)

	// Define flags for gendoc command
	gendocCmd.Flags().BoolVarP(&routes, "routes", "r", false, "create api routes markdown file")
	gendocCmd.Flags().BoolVarP(&openapi, "openapi", "o", false, "create or update OpenAPI specification")
}

func genRoutesDocAt(path string) error {
	routes, err := api.RouteCatalog()
	if err != nil {
		return fmt.Errorf("load route catalog: %w", err)
	}

	fmt.Print("Generating routes markdown file: ")
	md := catalogMarkdown(routes)
	if err := os.WriteFile(path, []byte(md), 0644); err != nil {
		return fmt.Errorf("write routes documentation: %w", err)
	}
	fmt.Println("OK")
	return nil
}

func genOpenAPIDoc() error {
	fmt.Print("Generating OpenAPI specification: ")

	routes, err := api.RouteCatalog()
	if err != nil {
		return fmt.Errorf("load route catalog: %w", err)
	}

	// Ensure docs directory exists
	docsDir := "docs"
	if _, err := os.Stat(docsDir); os.IsNotExist(err) {
		if err := os.Mkdir(docsDir, 0755); err != nil {
			return fmt.Errorf("create docs directory: %w", err)
		}
	}

	// Define the OpenAPI specification
	openAPIPath := filepath.Join(docsDir, "openapi.yaml")

	// Create base specification
	spec := catalogOpenAPISpec(routes)

	// Convert to YAML
	data, err := yaml.Marshal(spec)
	if err != nil {
		return fmt.Errorf("marshal OpenAPI spec: %w", err)
	}

	// Write to file
	if err := os.WriteFile(openAPIPath, data, 0644); err != nil {
		return fmt.Errorf("write OpenAPI spec: %w", err)
	}

	// Run swagger CLI to validate the spec if swag is installed
	if _, err := exec.LookPath("swag"); err == nil {
		cmd := exec.Command("swag", "fmt", "--dir", ".")
		if err := cmd.Run(); err != nil {
			log.Printf("Warning: Failed to format with swagger: %v", err)
		}
	} else {
		fmt.Println("Swag CLI not found. Install with: go install github.com/swaggo/swag/cmd/swag@latest")
	}

	fmt.Println("OK - OpenAPI specification generated/updated at", openAPIPath)
	return nil
}

func catalogMarkdown(routes []api.Route) string {
	var document strings.Builder
	document.WriteString("# MOTO REST API routes\n\n")
	for _, route := range routes {
		fmt.Fprintf(&document, "<details><summary>`%s`</summary>\n\n_%s_\n\n</details>\n\n", route.Pattern, route.Method)
	}
	return document.String()
}

func catalogOpenAPISpec(routes []api.Route) map[string]interface{} {
	spec := createOpenAPIBaseStructure()
	paths := spec["paths"].(map[string]interface{})
	for _, route := range routes {
		if paths[route.Pattern] == nil {
			paths[route.Pattern] = map[string]interface{}{}
		}
		switch route.Method {
		case "GET", "POST", "PUT", "DELETE", "PATCH":
			addMethod(paths, route.Pattern, route.Method)
		}
	}
	return spec
}

// createOpenAPIBaseStructure creates the base OpenAPI specification structure
func createOpenAPIBaseStructure() map[string]interface{} {
	return map[string]interface{}{
		"openapi": "3.0.3",
		"info": map[string]interface{}{
			"title":       "MOTO API",
			"description": "API for the MOTO school management system",
			"version":     "1.0.0",
			"contact": map[string]interface{}{
				"name": "MOTO Support",
			},
		},
		"servers": []map[string]interface{}{
			{
				"url":         "/api",
				"description": "API Base URL",
			},
		},
		"components": map[string]interface{}{
			"securitySchemes": map[string]interface{}{
				"bearerAuth": map[string]interface{}{
					"type":         "http",
					"scheme":       "bearer",
					"bearerFormat": "JWT",
				},
				"apiKeyAuth": map[string]interface{}{
					"type":        "apiKey",
					"in":          "header",
					"name":        "Authorization",
					"description": "API key for device authentication. Provide the API key as a Bearer token.",
				},
			},
			"schemas": getSettingsSchemas(),
		},
		"paths": map[string]interface{}{},
	}
}

// extractPathParams extracts URL parameters from a path pattern like /users/{id}
func extractPathParams(pattern string) []string {
	var params []string

	// Chi uses {paramName} for URL parameters
	// Regex to match {paramName} in the URL pattern
	r := regexp.MustCompile(`\{([^/]+)\}`)
	matches := r.FindAllStringSubmatch(pattern, -1)

	for _, match := range matches {
		if len(match) > 1 {
			params = append(params, match[1])
		}
	}

	return params
}

// getTagsFromPath returns API tags based on the URL path
func getTagsFromPath(path string) []string {
	parts := strings.Split(path, "/")

	// Find the first meaningful part of the path for tag
	for _, part := range parts {
		if part != "" && part != "api" {
			// Capitalize first letter of tag
			if len(part) > 0 {
				part = strings.ToUpper(part[:1]) + part[1:]
			}
			return []string{part}
		}
	}

	return []string{"API"}
}

// addMethod adds a method to a route in the paths map
func addMethod(paths map[string]interface{}, route string, method string) {
	// Get or create methods map for this path
	pathInfo := paths[route].(map[string]interface{})

	// Convert to lowercase for OpenAPI
	methodLower := strings.ToLower(method)

	// Skip if method already exists
	if pathInfo[methodLower] != nil {
		return
	}

	// Create a basic operation for this method
	pathInfo[methodLower] = map[string]interface{}{
		"summary":     fmt.Sprintf("%s %s", method, route),
		"description": "Generated from routes",
		"tags":        getTagsFromPath(route),
		"security": []map[string][]string{
			{"bearerAuth": {}},
		},
		"responses": map[string]interface{}{
			"200": map[string]interface{}{
				"description": "Successful operation",
			},
			"400": map[string]interface{}{
				"description": "Bad request",
			},
			"401": map[string]interface{}{
				"description": "Unauthorized",
			},
			"404": map[string]interface{}{
				"description": "Not found",
			},
			"500": map[string]interface{}{
				"description": "Internal server error",
			},
		},
	}

	// Add path parameters if any are in the route pattern
	pathParams := extractPathParams(route)
	if len(pathParams) > 0 {
		operation := pathInfo[methodLower].(map[string]interface{})
		parameters := []map[string]interface{}{}

		for _, param := range pathParams {
			parameters = append(parameters, map[string]interface{}{
				"name":        param,
				"in":          "path",
				"required":    true,
				"description": fmt.Sprintf("%s parameter", param),
				"schema": map[string]interface{}{
					"type": "string", // Default to string type, can be refined manually later
				},
			})
		}

		operation["parameters"] = parameters
	}
}

// getSettingsSchemas returns a map of schema definitions for settings-related models
func getSettingsSchemas() map[string]interface{} {
	return map[string]interface{}{
		"Setting": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id": map[string]interface{}{
					"type":        "integer",
					"format":      "int64",
					"description": "Unique identifier for the setting",
				},
				"key": map[string]interface{}{
					"type":        "string",
					"description": "Unique key identifying the setting",
				},
				"value": map[string]interface{}{
					"type":        "string",
					"description": "Value of the setting",
				},
				"category": map[string]interface{}{
					"type":        "string",
					"description": "Category the setting belongs to",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "Description of the setting",
				},
				"requires_restart": map[string]interface{}{
					"type":        "boolean",
					"description": "Indicates if the system needs to be restarted for the setting to take effect",
				},
				"requires_db_reset": map[string]interface{}{
					"type":        "boolean",
					"description": "Indicates if the database needs to be reset for the setting to take effect",
				},
				"created_at": map[string]interface{}{
					"type":        "string",
					"format":      "date-time",
					"description": "Timestamp when the setting was created",
				},
				"modified_at": map[string]interface{}{
					"type":        "string",
					"format":      "date-time",
					"description": "Timestamp when the setting was last modified",
				},
			},
			"required": []string{"id", "key", "value", "category"},
		},
		"SettingRequest": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"key": map[string]interface{}{
					"type":        "string",
					"description": "Unique key identifying the setting",
				},
				"value": map[string]interface{}{
					"type":        "string",
					"description": "Value of the setting",
				},
				"category": map[string]interface{}{
					"type":        "string",
					"description": "Category the setting belongs to",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "Description of the setting",
				},
				"requires_restart": map[string]interface{}{
					"type":        "boolean",
					"description": "Indicates if the system needs to be restarted for the setting to take effect",
				},
				"requires_db_reset": map[string]interface{}{
					"type":        "boolean",
					"description": "Indicates if the database needs to be reset for the setting to take effect",
				},
			},
			"required": []string{"key", "value", "category"},
		},
	}
}
