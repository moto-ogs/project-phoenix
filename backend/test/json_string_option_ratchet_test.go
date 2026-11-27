package test

import (
	"go/ast"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// TestNoJSONStringOptionRatchet holds the one identifier type of ADR 0300:
// an identifier is an ident.ID, which reads a JSON string or a number and
// goes out as a string in every answer. The json option ,string reads only a
// string, does not reach a list, and was the third spelling beside the
// retired alias common.ID and ident.ID (#7808). No Go file of the backend,
// tests included, uses it;
// there is no exception list. The generator rejects it on a registered type
// as well (api/contract).
func TestNoJSONStringOptionRatchet(t *testing.T) {
	t.Parallel()
	root, err := findBackendRoot()
	if err != nil {
		t.Fatal(err)
	}
	var found []string
	files, err := goSourceIndex(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range files {
		if inDirNamed(source.rel, "testdata", "vendor") {
			continue
		}
		hits, err := jsonStringOptions(filepath.Join(root, source.rel), source.content)
		if err != nil {
			t.Fatal(err)
		}
		for _, hit := range hits {
			found = append(found, source.rel+":"+hit)
		}
	}
	if len(found) > 0 {
		t.Fatalf("the json option ,string does not make an identifier; use ident.ID (ADR 0300):\n%s", strings.Join(found, "\n"))
	}
}

// jsonStringOptions returns line and field of each struct field whose json
// tag carries the option ,string.
func jsonStringOptions(path string, content []byte) ([]string, error) {
	fset, file, err := parseGoSourceCached(path, content)
	if err != nil {
		return nil, err
	}
	var hits []string
	ast.Inspect(file, func(node ast.Node) bool {
		field, ok := node.(*ast.Field)
		if !ok || field.Tag == nil {
			return true
		}
		raw, err := strconv.Unquote(field.Tag.Value)
		if err != nil {
			return true
		}
		_, options, _ := strings.Cut(reflect.StructTag(raw).Get("json"), ",")
		if slices.Contains(strings.Split(options, ","), "string") {
			hits = append(hits, strconv.Itoa(fset.Position(field.Pos()).Line))
		}
		return true
	})
	return hits, nil
}
