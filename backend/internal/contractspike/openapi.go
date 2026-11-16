package contractspike

import (
	"regexp"
	"strings"
)

type m = map[string]any

var pathParam = regexp.MustCompile(`\{([A-Za-z]+)\}`)

// OpenAPI is the first half of variant 2: an OpenAPI 3.1 document from the
// same model. What OpenAPI cannot say travels in x-moto-* extensions.
func OpenAPI(doc Document) m {
	schemas := m{
		"Pagination": m{"type": "object", "required": []string{"current_page", "page_size", "total_pages", "total_records"}, "properties": m{
			"current_page": m{"type": "integer"}, "page_size": m{"type": "integer"},
			"total_pages": m{"type": "integer"}, "total_records": m{"type": "integer"},
		}},
	}
	for _, object := range doc.Types {
		properties := m{}
		required := []string{}
		for _, field := range object.Fields {
			properties[field.Name] = openAPISchema(field.Schema)
			if !field.Optional {
				required = append(required, field.Name)
			}
		}
		schema := m{"type": "object", "properties": properties, "x-go-type": object.GoType}
		if len(required) > 0 {
			schema["required"] = required
		}
		schemas[object.Name] = schema
	}
	paths := m{}
	for _, route := range doc.Routes {
		operation := m{
			"operationId":    operationID(route),
			"x-moto-portals": route.Portals,
			"security":       []m{{"session": route.Portals}},
		}
		parameters := []m{}
		for _, match := range pathParam.FindAllStringSubmatch(route.Pattern, -1) {
			parameters = append(parameters, m{"name": match[1], "in": "path", "required": true, "schema": m{"type": "string"}})
		}
		var data m
		if route.Variants != nil {
			values := sortedKeys(route.Variants.Cases)
			parameters = append(parameters, m{"name": route.Variants.QueryParam, "in": "query", "schema": m{"type": "string", "enum": values, "default": route.Variants.Default}})
			// OpenAPI has no response that depends on a query parameter. The
			// payloads carry no discriminator either, so anyOf is all it can say.
			anyOf := []m{}
			cases := m{}
			for _, value := range values {
				anyOf = append(anyOf, openAPISchema(route.Variants.Cases[value]))
				cases[value] = openAPISchema(route.Variants.Cases[value])
			}
			data = m{"anyOf": anyOf}
			operation["x-moto-variants"] = m{"query_param": route.Variants.QueryParam, "default": route.Variants.Default, "cases": cases}
		} else {
			data = openAPISchema(*route.Response)
		}
		envelope := m{"type": "object", "required": []string{"status", "data"}, "properties": m{
			"status": m{"type": "string", "const": "success"}, "data": data, "message": m{"type": "string"},
		}}
		if route.Paginated {
			envelope["required"] = []string{"status", "data", "pagination"}
			envelope["properties"].(m)["pagination"] = m{"$ref": "#/components/schemas/Pagination"}
		}
		if len(parameters) > 0 {
			operation["parameters"] = parameters
		}
		operation["responses"] = m{"200": m{"description": "success", "content": m{"application/json": m{"schema": envelope}}}}
		paths[route.Pattern] = m{strings.ToLower(route.Method): operation}
	}
	return m{
		"openapi": "3.1.0",
		"info":    m{"title": "moto contract spike (#2342)", "version": "0.0.0"},
		"paths":   paths,
		"components": m{
			"schemas":         schemas,
			"securitySchemes": m{"session": m{"type": "oauth2", "flows": m{"password": m{"tokenUrl": "/auth/login", "scopes": m{"tenant": "Tenant portal session"}}}}},
		},
	}
}

func operationID(route Route) string {
	id := strings.ToLower(route.Method)
	for _, part := range strings.FieldsFunc(route.Pattern, func(r rune) bool { return r == '/' || r == '-' || r == '{' || r == '}' }) {
		if part == "api" {
			continue
		}
		id += strings.ToUpper(part[:1]) + part[1:]
	}
	return id
}

func openAPISchema(s Schema) m {
	var schema m
	switch s.Kind {
	case KindString:
		schema = m{"type": "string"}
	case KindBool:
		schema = m{"type": "boolean"}
	case KindInt:
		schema = m{"type": "integer"}
	case KindNumber:
		schema = m{"type": "number"}
	case KindID:
		schema = m{"type": "string", "pattern": `^-?[0-9]+$`, "x-moto-id": true}
	case KindLegacyID:
		schema = m{"type": "integer", "format": "int64", "x-moto-id": true}
	case KindLaxID:
		schema = m{"anyOf": []m{{"type": "string", "pattern": `^-?[0-9]+$`}, {"type": "integer", "format": "int64"}}, "x-moto-id": true}
	case KindDate:
		schema = m{"type": "string", "format": "date"}
	case KindInstant:
		schema = m{"type": "string", "format": "date-time"}
	case KindArray:
		schema = m{"type": "array", "items": openAPISchema(*s.Elem)}
	case KindMap:
		schema = m{"type": "object", "additionalProperties": openAPISchema(*s.Elem)}
	case KindRef:
		schema = m{"$ref": "#/components/schemas/" + s.Ref}
	}
	if !s.Nullable {
		return schema
	}
	if t, ok := schema["type"].(string); ok {
		schema["type"] = []string{t, "null"}
		return schema
	}
	return m{"anyOf": []m{schema, {"type": "null"}}}
}
