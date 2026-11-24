package test

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// The parser binds same-file local identifiers. Struct fields are resolved
// separately from the explicitly typed composite literal, not by ast.Object.
type localBinding = ast.Object //nolint:staticcheck // only used for local bindings

type declaredType struct {
	expr ast.Expr
	file parsedSource
}

type integerFormatScan struct {
	module   string
	file     parsedSource
	types    map[string]declaredType
	integers map[string]bool
	values   map[*localBinding][]ast.Expr
}

func TestFormattedIdentifierScannerFollowsIntegerFields(t *testing.T) {
	t.Parallel()
	const module = "example.test"
	fset := token.NewFileSet()
	source := "package http\n" +
		"import text \"fmt\"\n" +
		"type record struct { ReviewerID int64; Label string }\n" +
		"type reply struct { ReviewedBy string `json:\"reviewed_by\"`; Title string `json:\"title\"` }\n" +
		"func respond(r *record) reply { label := r.Label; who := r.ReviewerID; return reply{ReviewedBy: text.Sprint(who), Title: text.Sprint(label)} }\n" +
		"func assign(r record) reply { var out reply; out.ReviewedBy = text.Sprint(r.ReviewerID); return out }\n"
	file, err := parser.ParseFile(fset, "reply.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	findings := formattedIdentifierFields([]parsedSource{{
		dir: "api", rel: "reply.go", fset: fset, file: file,
		imports: map[string]string{"text": "fmt"},
	}}, module, nil, nil)
	if len(findings) != 2 || !strings.Contains(findings[0], "ReviewedBy") || !strings.Contains(findings[1], "ReviewedBy") {
		t.Fatalf("expected findings for the literal and assignment, got %v", findings)
	}
}

// Follow values into tagged JSON fields, not the spelling of the field.
func formattedIdentifierFields(files []parsedSource, module string, integers, textTypes map[string]bool) []string {
	fields := map[string]map[string]bool{}
	types := map[string]declaredType{}
	for _, file := range files {
		ast.Inspect(file.file, func(node ast.Node) bool {
			spec, ok := node.(*ast.TypeSpec)
			if ok {
				key := module + "/" + file.dir + "." + spec.Name.Name
				types[key] = declaredType{spec.Type, file}
				if seamPackage(file.dir) {
					fields[key] = unmarkedStringFields(spec.Type, file, module, textTypes)
				}
			}
			return true
		})
	}
	var findings []string
	for _, file := range files {
		if !seamPackage(file.dir) {
			continue
		}
		values := map[*localBinding][]ast.Expr{}
		ast.Inspect(file.file, func(node ast.Node) bool {
			switch n := node.(type) {
			case *ast.AssignStmt:
				for i, left := range n.Lhs {
					if id, ok := left.(*ast.Ident); ok && id.Obj != nil && len(n.Rhs) == len(n.Lhs) {
						values[id.Obj] = append(values[id.Obj], n.Rhs[i])
					}
				}
			case *ast.ValueSpec:
				for i, name := range n.Names {
					if name.Obj != nil && len(n.Values) == len(n.Names) {
						values[name.Obj] = append(values[name.Obj], n.Values[i])
					}
				}
			}
			return true
		})
		scan := integerFormatScan{module: module, file: file, types: types, integers: integers, values: values}
		ast.Inspect(file.file, func(node ast.Node) bool {
			if literal, ok := node.(*ast.CompositeLit); ok && literal.Type != nil {
				stringFields := contractStringFields(literal.Type, file, module, textTypes, fields)
				for _, element := range literal.Elts {
					pair, ok := element.(*ast.KeyValueExpr)
					if !ok {
						continue
					}
					if field, ok := pair.Key.(*ast.Ident); ok && stringFields[field.Name] {
						findings = scan.appendFinding(findings, field, pair.Value)
					}
				}
			}
			if assign, ok := node.(*ast.AssignStmt); ok && len(assign.Lhs) == len(assign.Rhs) {
				for i, left := range assign.Lhs {
					field, ok := ast.Unparen(left).(*ast.SelectorExpr)
					if !ok {
						continue
					}
					receiver := scan.argumentType(field.X, map[*localBinding]bool{})
					if contractStringFields(receiver.expr, receiver.file, module, textTypes, fields)[field.Sel.Name] {
						findings = scan.appendFinding(findings, field.Sel, assign.Rhs[i])
					}
				}
			}
			return true
		})
	}
	return findings
}

func (scan integerFormatScan) appendFinding(findings []string, field *ast.Ident, value ast.Expr) []string {
	if !scan.manuallyFormatted(value, map[*localBinding]bool{}) {
		return findings
	}
	return append(findings, fmt.Sprintf("%s:%d %s: formatted integer in a JSON string field; use ident.ID", scan.file.rel, scan.file.fset.Position(field.Pos()).Line, field.Name))
}

func contractStringFields(expr ast.Expr, file parsedSource, module string, textTypes map[string]bool, fields map[string]map[string]bool) map[string]bool {
	if pointer, ok := expr.(*ast.StarExpr); ok {
		expr = pointer.X
	}
	if _, ok := expr.(*ast.StructType); ok {
		return unmarkedStringFields(expr, file, module, textTypes)
	}
	key, _ := typeKey(expr, &file, module, builtinStrings)
	return fields[key]
}

func unmarkedStringFields(expr ast.Expr, file parsedSource, module string, textTypes map[string]bool) map[string]bool {
	structure, ok := expr.(*ast.StructType)
	if !ok {
		return nil
	}
	fields := map[string]bool{}
	for _, field := range structure.Fields.List {
		if field.Tag == nil || !scalarField(field.Type, &file, module, builtinStrings, textTypes) {
			continue
		}
		raw, _ := strconv.Unquote(field.Tag.Value)
		tag := reflect.StructTag(raw)
		name, _, _ := strings.Cut(tag.Get("json"), ",")
		if _, tagged := tag.Lookup("json"); !tagged || name == "-" || tag.Get("contract_text") != "" {
			continue
		}
		for _, id := range field.Names {
			fields[id.Name] = true
		}
	}
	return fields
}

func (scan integerFormatScan) manuallyFormatted(expr ast.Expr, seen map[*localBinding]bool) bool {
	switch expr := ast.Unparen(expr).(type) {
	case *ast.Ident:
		if expr.Obj == nil || seen[expr.Obj] {
			return false
		}
		seen[expr.Obj] = true
		defer delete(seen, expr.Obj)
		for _, bound := range scan.values[expr.Obj] {
			if scan.manuallyFormatted(bound, seen) {
				return true
			}
		}
	case *ast.CallExpr:
		fn, ok := ast.Unparen(expr.Fun).(*ast.SelectorExpr)
		if !ok {
			return false
		}
		pkg, ok := fn.X.(*ast.Ident)
		if !ok || pkg.Obj != nil {
			return false
		}
		switch scan.file.imports[pkg.Name] {
		case "strconv":
			return fn.Sel.Name == "FormatInt" || fn.Sel.Name == "Itoa"
		case "fmt":
			if len(expr.Args) == 1 && (fn.Sel.Name == "Sprint" || fn.Sel.Name == "Sprintln") {
				return scan.integerArgument(expr.Args[0])
			}
			if fn.Sel.Name == "Sprintf" && len(expr.Args) == 2 {
				if format, ok := ast.Unparen(expr.Args[0]).(*ast.BasicLit); ok {
					value, _ := strconv.Unquote(format.Value)
					return value == "%d" || (value == "%v" && scan.integerArgument(expr.Args[1]))
				}
			}
		}
	}
	return false
}

func (scan integerFormatScan) integerArgument(expr ast.Expr) bool {
	decl := scan.argumentType(expr, map[*localBinding]bool{})
	if decl.expr == nil {
		return false
	}
	key, builtin := typeKey(decl.expr, &decl.file, scan.module, builtinIntegers)
	return builtin || scan.integers[key] || key == scan.module+"/sharedkernel/ident.ID"
}

func (scan integerFormatScan) argumentType(expr ast.Expr, seen map[*localBinding]bool) declaredType {
	switch expr := ast.Unparen(expr).(type) {
	case *ast.Ident:
		if expr.Obj == nil || seen[expr.Obj] {
			break
		}
		seen[expr.Obj] = true
		defer delete(seen, expr.Obj)
		switch decl := expr.Obj.Decl.(type) {
		case *ast.Field:
			return declaredType{decl.Type, scan.file}
		case *ast.ValueSpec:
			if decl.Type != nil {
				return declaredType{decl.Type, scan.file}
			}
		}
		if values := scan.values[expr.Obj]; len(values) > 0 {
			return scan.argumentType(values[0], seen)
		}
	case *ast.SelectorExpr:
		receiver := scan.argumentType(expr.X, seen)
		return scan.structFieldType(receiver, expr.Sel.Name)
	case *ast.StarExpr:
		operand := scan.argumentType(expr.X, seen)
		if ptr, ok := operand.expr.(*ast.StarExpr); ok {
			return declaredType{ptr.X, operand.file}
		}
	case *ast.UnaryExpr:
		if expr.Op == token.AND {
			operand := scan.argumentType(expr.X, seen)
			if operand.expr != nil {
				return declaredType{&ast.StarExpr{X: operand.expr}, operand.file}
			}
		}
	case *ast.CompositeLit:
		return declaredType{expr.Type, scan.file}
	case *ast.CallExpr:
		key, builtin := typeKey(expr.Fun, &scan.file, scan.module, builtinIntegers)
		if _, named := scan.types[key]; builtin || named {
			return declaredType{expr.Fun, scan.file}
		}
	}
	return declaredType{}
}

func (scan integerFormatScan) structFieldType(decl declaredType, name string) declaredType {
	if ptr, ok := decl.expr.(*ast.StarExpr); ok {
		decl.expr = ptr.X
	}
	seen := map[string]bool{}
	for decl.expr != nil {
		if structure, ok := decl.expr.(*ast.StructType); ok {
			for _, field := range structure.Fields.List {
				for _, identifier := range field.Names {
					if identifier.Name == name {
						return declaredType{field.Type, decl.file}
					}
				}
			}
			break
		}
		key, _ := typeKey(decl.expr, &decl.file, scan.module, builtinStrings)
		if seen[key] {
			break
		}
		seen[key] = true
		decl = scan.types[key]
	}
	return declaredType{}
}
