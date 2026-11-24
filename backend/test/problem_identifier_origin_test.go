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

// The error boundary can receive DTOs from any package. Start at the
// envelope and details writers, then follow their values and referenced types.
func problemIdentifierOrigins(files []parsedSource, module string, integers map[string]bool) []string {
	types := map[string]declaredType{}
	for _, file := range files {
		ast.Inspect(file.file, func(node ast.Node) bool {
			if spec, ok := node.(*ast.TypeSpec); ok {
				types[module+"/"+file.dir+"."+spec.Name.Name] = declaredType{spec.Type, file}
			}
			return true
		})
	}
	common := module + "/api/common."
	var findings []string
	for _, file := range files {
		if deviceAPI(file.dir, "") {
			continue
		}
		values := map[*localBinding][]ast.Expr{}
		ast.Inspect(file.file, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.AssignStmt:
				for i, left := range value.Lhs {
					if id, ok := left.(*ast.Ident); ok && id.Obj != nil && len(value.Rhs) == len(value.Lhs) {
						values[id.Obj] = append(values[id.Obj], value.Rhs[i])
					}
				}
			case *ast.ValueSpec:
				for i, name := range value.Names {
					if name.Obj != nil && len(value.Values) == len(value.Names) {
						values[name.Obj] = append(values[name.Obj], value.Values[i])
					}
				}
			}
			return true
		})
		scan := integerFormatScan{module: module, file: file, types: types, integers: integers, values: values}
		check := func(expr ast.Expr) {
			inspectProblemValue(scan, expr, map[ast.Expr]bool{}, func(field *ast.Field, source parsedSource) {
				findings = append(findings, fmt.Sprintf("%s:%d: numeric identifier %s in a problem response",
					source.rel, source.fset.Position(field.Pos()).Line, field.Names[0]))
			})
		}
		ast.Inspect(file.file, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.CompositeLit:
				if embeddedProblemEnvelope(value.Type, file, module, common, types, map[string]bool{}) {
					check(value)
				}
			case *ast.CallExpr:
				name, _ := typeKey(value.Fun, &file, module, nil)
				if name == common+"RenderError" && len(value.Args) == 3 {
					check(value.Args[2])
				}
				if strings.HasPrefix(name, common+"Error") && strings.HasSuffix(name, "Details") && len(value.Args) > 0 {
					check(value.Args[len(value.Args)-1])
				}
			case *ast.FuncDecl:
				if value.Recv != nil && value.Name.Name == "ErrorDetails" {
					ast.Inspect(value.Body, func(node ast.Node) bool {
						if result, ok := node.(*ast.ReturnStmt); ok {
							for _, expr := range result.Results {
								check(expr)
							}
						}
						return true
					})
				}
			}
			return true
		})
	}
	return findings
}

func embeddedProblemEnvelope(expr ast.Expr, file parsedSource, module, common string, types map[string]declaredType, seen map[string]bool) bool {
	switch expr := expr.(type) {
	case *ast.StarExpr:
		return embeddedProblemEnvelope(expr.X, file, module, common, types, seen)
	case *ast.StructType:
		for _, field := range expr.Fields.List {
			if len(field.Names) == 0 && embeddedProblemEnvelope(field.Type, file, module, common, types, seen) {
				return true
			}
		}
	default:
		key, _ := typeKey(expr, &file, module, nil)
		if key == common+"ErrResponse" {
			return true
		}
		if binding, ok := types[key]; ok && !seen[key] {
			seen[key] = true
			return embeddedProblemEnvelope(binding.expr, binding.file, module, common, types, seen)
		}
	}
	return false
}

func inspectProblemValue(scan integerFormatScan, expr ast.Expr, seen map[ast.Expr]bool, found func(*ast.Field, parsedSource)) {
	if expr == nil || seen[expr] {
		return
	}
	seen[expr] = true
	decl := scan.argumentType(expr, map[*localBinding]bool{})
	inspectProblemType(scan, decl.expr, decl.file, map[string]bool{}, found)
	switch expr := ast.Unparen(expr).(type) {
	case *ast.Ident:
		for _, value := range scan.values[expr.Obj] {
			inspectProblemValue(scan, value, seen, found)
		}
	case *ast.UnaryExpr:
		inspectProblemValue(scan, expr.X, seen, found)
	case *ast.CompositeLit:
		typeName, _ := typeKey(expr.Type, &scan.file, scan.module, nil)
		for _, item := range expr.Elts {
			if field, ok := item.(*ast.KeyValueExpr); ok {
				// Err is retained for server diagnostics and has json:"-".
				if name, ok := field.Key.(*ast.Ident); ok && name.Name == "Err" &&
					typeName == scan.module+"/api/common.ErrResponse" {
					continue
				}
				item = field.Value
			}
			inspectProblemValue(scan, item, seen, found)
		}
	}
}

func inspectProblemType(scan integerFormatScan, expr ast.Expr, file parsedSource, seen map[string]bool, found func(*ast.Field, parsedSource)) {
	switch expr := expr.(type) {
	case *ast.StarExpr:
		inspectProblemType(scan, expr.X, file, seen, found)
	case *ast.ArrayType:
		inspectProblemType(scan, expr.Elt, file, seen, found)
	case *ast.MapType:
		inspectProblemType(scan, expr.Value, file, seen, found)
	case *ast.StructType:
		for _, field := range expr.Fields.List {
			if field.Tag != nil {
				raw, _ := strconv.Unquote(field.Tag.Value)
				if reflect.StructTag(raw).Get("json") == "-" {
					continue
				}
			}
			if len(field.Names) != 0 && problemIdentifierField(field) &&
				scalarField(field.Type, &file, scan.module, builtinIntegers, scan.integers) {
				found(field, file)
			}
			inspectProblemType(scan, field.Type, file, seen, found)
		}
	default:
		key, _ := typeKey(expr, &file, scan.module, nil)
		if binding, ok := scan.types[key]; ok && !seen[key] {
			seen[key] = true
			inspectProblemType(scan, binding.expr, binding.file, seen, found)
		}
	}
}

func problemIdentifierField(field *ast.Field) bool {
	if field.Tag != nil {
		raw, _ := strconv.Unquote(field.Tag.Value)
		name, _, _ := strings.Cut(reflect.StructTag(raw).Get("json"), ",")
		if name != "" {
			return identifierName(name)
		}
	}
	name := field.Names[0].Name
	return strings.HasSuffix(name, "ID") || strings.HasSuffix(name, "IDs")
}

func TestProblemIdentifierOriginsFollowPublicTypes(t *testing.T) {
	t.Parallel()
	const module = "example.test"
	makeFile := func(dir, source string, imports map[string]string) parsedSource {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, dir+"/probe.go", source, 0)
		if err != nil {
			t.Fatal(err)
		}
		return parsedSource{dir: dir, rel: dir + "/probe.go", fset: fset, file: file, imports: imports}
	}
	files := []parsedSource{
		makeFile("modules/owner", `package owner
type Problem struct { StudentID int64 `+"\x60"+`json:"student_id"`+"\x60"+` }
type NotOnWire struct { LessonID int64 }
`, nil),
		makeFile("modules/owner/adapter", `package adapter
type envelope struct { *c.ErrResponse; Conflicts []o.Problem }
func refuse() { details := envelope{}; c.RenderError(w, r, &details) }
`, map[string]string{"o": module + "/modules/owner", "c": module + "/api/common"}),
	}
	got := strings.Join(problemIdentifierOrigins(files, module, nil), "\n")
	if !strings.Contains(got, "modules/owner/probe.go:2: numeric identifier StudentID") || strings.Contains(got, "LessonID") {
		t.Fatalf("error source was not followed independently of package: %s", got)
	}
}
