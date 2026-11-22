package test

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// TestNoNumericIdentifierRatchet holds #7808: no type at the client seam
// reads or writes an identifier as a JSON number. An identifier is an
// ident.ID, which every answer writes as a string (ADR 0300). The generator
// refuses a numeric identifier on a registered type; this test also covers
// the types outside the contract (device routes, error details, bodies a
// handler decodes by hand).
//
// It parses every non-test Go file of the client-facing packages (see
// seamPackage) and fails on a struct field whose json name is id, *_id or
// *_ids and whose type is an integer, a pointer, list or map of one, or a
// named integer type, unless the field carries contract:"number". That tag
// is allowed only in the kiosk device API (deviceAPI): PyrePortal v1.11.5
// reads numeric identifiers there. There is no other exception list.
func TestNoNumericIdentifierRatchet(t *testing.T) {
	t.Parallel()
	root, err := findBackendRoot()
	if err != nil {
		t.Fatal(err)
	}
	module := strings.TrimSuffix(backendModulePath, "/")
	files, err := parseBackendSources(root, module)
	if err != nil {
		t.Fatal(err)
	}
	integers := namedIntegerTypes(files, module)
	var found []string
	for _, file := range files {
		if !seamPackage(file.dir) {
			continue
		}
		found = append(found, numericIdentifierFields(file, module, integers)...)
	}
	sort.Strings(found)
	if len(found) > 0 {
		t.Fatalf("an identifier travels as text: use ident.ID (ADR 0300, #7808); contract:\"number\" belongs only to the kiosk device API:\n%s", strings.Join(found, "\n"))
	}
}

// seamPackage tells whether a package (slash path relative to backend/)
// encodes or decodes what a client sends: the API root and every http and
// inbound role of a module or workflow.
func seamPackage(dir string) bool {
	parts := strings.Split(dir, "/")
	switch {
	case parts[0] == "api":
		return true
	case (parts[0] == "modules" || parts[0] == "workflows") && len(parts) >= 3:
		return parts[2] == "http" || parts[2] == "inbound"
	}
	return false
}

// deviceAPI tells whether a type is part of the kiosk device API, the one
// place an identifier stays a JSON number: PyrePortal v1.11.5 reads numeric
// identifiers from /api/iot/* and from POST/DELETE /api/students/{id}/rfid.
func deviceAPI(dir, typeName string) bool {
	switch {
	case dir == "api/iot" || strings.HasPrefix(dir, "api/iot/"):
		return true
	case strings.HasPrefix(dir, "modules/devicescan/http/"):
		return true
	case dir == "modules/peopledirectory/inbound/students":
		return typeName == "RFIDAssignmentResponse"
	}
	return false
}

type parsedSource struct {
	dir     string // slash path relative to backend/
	rel     string
	fset    *token.FileSet
	file    *ast.File
	imports map[string]string // local name -> import path
}

// parseBackendSources parses every non-test Go file of the backend: named
// integer types may come from any package.
func parseBackendSources(root, module string) ([]parsedSource, error) {
	var files []parsedSource
	packageNames := map[string]string{}
	err := filepath.WalkDir(root, func(full string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if full != root && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "testdata" || entry.Name() == "vendor") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(full, ".go") || strings.HasSuffix(full, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, full, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, full)
		rel = filepath.ToSlash(rel)
		files = append(files, parsedSource{dir: path.Dir(rel), rel: rel, fset: fset, file: file})
		packageNames[path.Dir(rel)] = file.Name.Name
		return nil
	})
	if err != nil {
		return nil, err
	}
	for i := range files {
		files[i].imports = map[string]string{}
		for _, spec := range files[i].file.Imports {
			importPath, _ := strconv.Unquote(spec.Path.Value)
			name := path.Base(importPath)
			if dir, ok := strings.CutPrefix(importPath, module+"/"); ok && packageNames[dir] != "" {
				name = packageNames[dir]
			}
			if spec.Name != nil {
				name = spec.Name.Name
			}
			files[i].imports[name] = importPath
		}
	}
	return files, nil
}

var builtinIntegers = map[string]bool{
	"int": true, "int8": true, "int16": true, "int32": true, "int64": true,
	"uint": true, "uint8": true, "uint16": true, "uint32": true, "uint64": true,
}

// namedIntegerTypes returns "importpath.Name" of every named type whose
// underlying type is an integer. ident.ID is the identifier type, written as
// a string in every answer, and not one of them.
func namedIntegerTypes(files []parsedSource, module string) map[string]bool {
	type spec struct {
		file *parsedSource
		expr ast.Expr
	}
	specs := map[string]spec{}
	for i := range files {
		file := &files[i]
		for _, decl := range file.file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.TYPE {
				continue
			}
			for _, s := range gen.Specs {
				typeSpec := s.(*ast.TypeSpec)
				specs[module+"/"+file.dir+"."+typeSpec.Name.Name] = spec{file: file, expr: typeSpec.Type}
			}
		}
	}
	integers := map[string]bool{}
	for changed := true; changed; {
		changed = false
		for name, s := range specs {
			if integers[name] || name == module+"/sharedkernel/ident.ID" {
				continue
			}
			if key, builtin := typeKey(s.expr, s.file, module); builtin || integers[key] {
				integers[name] = true
				changed = true
			}
		}
	}
	return integers
}

// typeKey names the type of a plain or qualified identifier: the builtin
// integer flag, or "importpath.Name".
func typeKey(expr ast.Expr, file *parsedSource, module string) (string, bool) {
	switch e := expr.(type) {
	case *ast.Ident:
		if builtinIntegers[e.Name] {
			return "", true
		}
		return module + "/" + file.dir + "." + e.Name, false
	case *ast.SelectorExpr:
		if pkg, ok := e.X.(*ast.Ident); ok {
			return file.imports[pkg.Name] + "." + e.Sel.Name, false
		}
	}
	return "", false
}

// numericInteger tells whether a field type is an integer, or a pointer,
// list or map of one.
func numericInteger(expr ast.Expr, file *parsedSource, module string, integers map[string]bool) bool {
	for {
		switch e := expr.(type) {
		case *ast.StarExpr:
			expr = e.X
			continue
		case *ast.ArrayType:
			expr = e.Elt
			continue
		case *ast.MapType:
			expr = e.Value
			continue
		}
		key, builtin := typeKey(expr, file, module)
		return builtin || integers[key]
	}
}

func identifierName(name string) bool {
	return name == "id" || strings.HasSuffix(name, "_id") || strings.HasSuffix(name, "_ids")
}

// numericIdentifierFields reports the fields of one file that break the
// rule, as "file:line Type.Field: reason". It reads every struct of the file,
// also an anonymous one inside a function, which a handler may encode.
func numericIdentifierFields(file parsedSource, module string, integers map[string]bool) []string {
	type scope struct {
		node ast.Node
		name string
	}
	var scopes []scope
	ast.Inspect(file.file, func(node ast.Node) bool {
		switch decl := node.(type) {
		case *ast.TypeSpec:
			scopes = append(scopes, scope{decl, decl.Name.Name})
		case *ast.FuncDecl:
			scopes = append(scopes, scope{decl, decl.Name.Name})
		}
		return true
	})
	// enclosing names the innermost declared type or function around a
	// field.
	enclosing := func(pos token.Pos) string {
		name, width := "", token.Pos(-1)
		for _, s := range scopes {
			if s.node.Pos() <= pos && pos < s.node.End() && (width < 0 || s.node.End()-s.node.Pos() < width) {
				name, width = s.name, s.node.End()-s.node.Pos()
			}
		}
		return name
	}
	var found []string
	ast.Inspect(file.file, func(node ast.Node) bool {
		field, ok := node.(*ast.Field)
		if !ok || field.Tag == nil || len(field.Names) == 0 {
			return true
		}
		raw, err := strconv.Unquote(field.Tag.Value)
		if err != nil {
			return true
		}
		tag := reflect.StructTag(raw)
		name, _, _ := strings.Cut(tag.Get("json"), ",")
		if !identifierName(name) || !numericInteger(field.Type, &file, module, integers) {
			return true
		}
		typeName := enclosing(field.Pos())
		at := fmt.Sprintf("%s:%d %s.%s", file.rel, file.fset.Position(field.Pos()).Line, typeName, field.Names[0].Name)
		number := tag.Get("contract") == "number"
		device := deviceAPI(file.dir, typeName)
		switch {
		case device && !number:
			found = append(found, at+": a kiosk identifier says contract:\"number\"")
		case !device && number:
			found = append(found, at+": contract:\"number\" on an identifier outside the kiosk device API")
		case !device:
			found = append(found, at+": numeric identifier")
		}
		return true
	})
	return found
}

// TestNumericIdentifierScannerFindsEachForm feeds the scanner one synthetic
// file of each package kind.
func TestNumericIdentifierScannerFindsEachForm(t *testing.T) {
	t.Parallel()
	module := strings.TrimSuffix(backendModulePath, "/")
	source := strings.ReplaceAll(`package x

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

type count int64

type row struct {
	ID       int64      'json:"id"'
	Owner    *int64     'json:"owner_id,omitempty"'
	Members  []int      'json:"member_ids"'
	Counted  count      'json:"counted_id"'
	Tagged   int64      'json:"tagged_id" contract:"number"'
	Text     ident.ID   'json:"text_id"'
	Texts    []ident.ID 'json:"text_ids"'
	Amount   int64      'json:"amount_cents" contract:"number"'
	Untagged int64
}

func handler() any {
	return struct {
		Inline int64 'json:"inline_id"'
	}{}
}
`, "'", "`")
	scan := func(dir string) []string {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, dir+"/x.go", source, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		parsed := parsedSource{dir: dir, rel: dir + "/x.go", fset: fset, file: file,
			imports: map[string]string{"ident": module + "/sharedkernel/ident"}}
		var found []string
		for _, hit := range numericIdentifierFields(parsed, module, namedIntegerTypes([]parsedSource{parsed}, module)) {
			_, rest, _ := strings.Cut(hit, " ")
			found = append(found, rest)
		}
		return found
	}
	want := []string{
		"row.ID: numeric identifier",
		"row.Owner: numeric identifier",
		"row.Members: numeric identifier",
		"row.Counted: numeric identifier",
		"row.Tagged: contract:\"number\" on an identifier outside the kiosk device API",
		"handler.Inline: numeric identifier",
	}
	if got := scan("modules/x/http"); !slices.Equal(got, want) {
		t.Errorf("seam package:\n got %q\nwant %q", got, want)
	}
	kiosk := []string{
		"row.ID: a kiosk identifier says contract:\"number\"",
		"row.Owner: a kiosk identifier says contract:\"number\"",
		"row.Members: a kiosk identifier says contract:\"number\"",
		"row.Counted: a kiosk identifier says contract:\"number\"",
		"handler.Inline: a kiosk identifier says contract:\"number\"",
	}
	if got := scan("modules/devicescan/http/x"); !slices.Equal(got, kiosk) {
		t.Errorf("kiosk package:\n got %q\nwant %q", got, kiosk)
	}
	if !seamPackage("modules/x/http") || !seamPackage("workflows/x/inbound/y") || !seamPackage("api/x") || seamPackage("modules/x") || seamPackage("modules/x/internal/http") {
		t.Error("seamPackage covers the api root and every http and inbound role")
	}
}
