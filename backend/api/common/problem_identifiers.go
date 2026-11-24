package common

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

// numericProblemDetailsObserver is installed only by the testhooks build.
var numericProblemDetailsObserver func(*http.Request)

func repairProblemIdentifiers(r *http.Request, body map[string]json.RawMessage, logger func() *slog.Logger) {
	raw := body["details"]
	if len(raw) == 0 || r.URL.Path == "/api/iot" || strings.HasPrefix(r.URL.Path, "/api/iot/") {
		return
	}
	details, repaired := problemIdentifiers(raw)
	if !repaired {
		return
	}
	body["details"] = details
	if numericProblemDetailsObserver != nil {
		numericProblemDetailsObserver(r)
	}
	logger().ErrorContext(r.Context(), "numeric identifier in error details",
		slog.String("route", RoutePattern(r)),
		slog.String("code", problemStringField(body, "code")),
	)
}

// problemIdentifiers repairs untyped or legacy error details at the final
// HTTP boundary. UseNumber preserves bigint values before they become text.
// The boolean reports whether the original detail violated the wire contract.
func problemIdentifiers(raw json.RawMessage) (json.RawMessage, bool) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return raw, false
	}
	value, changed := stringifyProblemIdentifiers(value, false)
	if !changed {
		return raw, false
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return raw, false
	}
	return encoded, true
}

func stringifyProblemIdentifiers(value any, identifier bool) (any, bool) {
	changed := false
	switch item := value.(type) {
	case json.Number:
		if identifier {
			return item.String(), true
		}
	case map[string]any:
		for key, member := range item {
			name := strings.ToLower(key)
			id := name == "id" || strings.HasSuffix(name, "_id") || strings.HasSuffix(name, "_ids")
			next, converted := stringifyProblemIdentifiers(member, id)
			item[key] = next
			changed = changed || converted
		}
	case []any:
		for i, member := range item {
			next, converted := stringifyProblemIdentifiers(member, identifier)
			item[i] = next
			changed = changed || converted
		}
	}
	return value, changed
}
