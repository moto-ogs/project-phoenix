package contractspike

import (
	"fmt"
	"strings"
)

// Swift is the native half of variant 1: what one more writer of the own
// generator looks like. Codable ignores unknown keys by itself. ContractID
// and the envelopes are the handwritten ContractRuntime.swift.
func Swift(doc Document) string {
	var out strings.Builder
	out.WriteString(tsHeader + "import Foundation\n")
	for _, object := range doc.Types {
		fmt.Fprintf(&out, "\n/// Go: %s\npublic struct %s: Decodable, Sendable {\n", object.GoType, object.Name)
		for _, field := range object.Fields {
			t := swiftType(field.Schema)
			if field.Optional && !strings.HasSuffix(t, "?") {
				t += "?"
			}
			fmt.Fprintf(&out, "    public let %s: %s\n", camel(field.Name), t)
		}
		out.WriteString("\n    enum CodingKeys: String, CodingKey {\n")
		for _, field := range object.Fields {
			fmt.Fprintf(&out, "        case %s = %q\n", camel(field.Name), field.Name)
		}
		out.WriteString("    }\n}\n")
	}
	out.WriteString("\npublic enum Routes {\n")
	for _, route := range doc.Routes {
		wrap := "Success"
		if route.Paginated {
			wrap = "Paginated"
		}
		name := operationID(route)
		if route.Variants == nil {
			fmt.Fprintf(&out, "    /// %s %s\n    public typealias %s = %s<%s>\n", route.Method, route.Pattern, upperFirst(name), wrap, swiftType(*route.Response))
			continue
		}
		for _, value := range sortedKeys(route.Variants.Cases) {
			fmt.Fprintf(&out, "    /// %s %s?%s=%s\n    public typealias %s%s = %s<%s>\n", route.Method, route.Pattern, route.Variants.QueryParam, value, upperFirst(name), upperFirst(value), wrap, swiftType(route.Variants.Cases[value]))
		}
	}
	out.WriteString("}\n")
	return out.String()
}

func upperFirst(s string) string { return strings.ToUpper(s[:1]) + s[1:] }

func camel(name string) string {
	parts := strings.Split(name, "_")
	for i := 1; i < len(parts); i++ {
		if parts[i] != "" {
			parts[i] = upperFirst(parts[i])
		}
	}
	return strings.Join(parts, "")
}

func swiftType(s Schema) string {
	var t string
	switch s.Kind {
	case KindString, KindDate:
		t = "String"
	case KindBool:
		t = "Bool"
	case KindInt:
		t = "Int"
	case KindNumber:
		t = "Double"
	case KindID, KindLegacyID, KindLaxID:
		t = "ContractID"
	case KindInstant:
		t = "Date"
	case KindArray:
		t = "[" + swiftType(*s.Elem) + "]"
	case KindMap:
		t = "[String: " + swiftType(*s.Elem) + "]"
	case KindRef:
		t = s.Ref
	}
	if s.Nullable {
		t += "?"
	}
	return t
}
