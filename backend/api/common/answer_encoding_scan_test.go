package common_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"slices"
	"sort"
	"strings"
	"testing"
)

func TestAnswerEncodingScanIsIndependentOfSpelling(t *testing.T) {
	t.Parallel()
	const source = `package probe
import (
	h "net/http"
	std "encoding/json"
	"encoding/json/v2"
	"encoding/json/jsontext"
	"bytes"
	chiJSON "github.com/go-chi/render"
)
var writeJSON = json.MarshalWrite

func writer(rw h.ResponseWriter, r *h.Request, value any) {
	chiJSON. // rejected
		JSON(rw, r, value)
	out := rw
	std. // rejected
		NewEncoder(out).Encode(value)
	buf, _ := std.Marshal(value) // rejected
	_, _ = rw.Write(buf)
	func() {
		std.NewEncoder(rw).Encode(value) // rejected
	}()
	encode := std.NewEncoder
	encode(rw).Encode(value) // rejected
	var encodeAgain = std.NewEncoder
	encodeAgain(rw).Encode(value) // rejected
	writeJSON(rw, value) // rejected
	json.MarshalWrite(rw, value) // rejected
	json.MarshalEncode(jsontext.NewEncoder(rw), value) // rejected
}
func shadowed(w h.ResponseWriter, value any) {
	{
		var w bytes.Buffer
		std.NewEncoder(&w).Encode(value)
	}
	std.NewEncoder(w).Encode(value) // rejected
}
func closureWrite(w h.ResponseWriter, value any) {
	buf, _ := std.Marshal(value) // rejected
	func() { _, _ = w.Write(append(buf, '\n')) }()
}
func persisted(w h.ResponseWriter, value any) {
	buf, _ := std.Marshal(value)
	save(buf)
	_, _ = w.Write([]byte("unrelated"))
}
func overwritten(w h.ResponseWriter, value any) {
	buf, _ := std.Marshal(value)
	save(buf)
	buf = []byte("unrelated")
	_, _ = w.Write(buf)
}
func conditional(w h.ResponseWriter, value any, replace bool) {
	buf, _ := std.Marshal(value) // rejected
	if replace {
		buf = []byte("unrelated")
	}
	_, _ = w.Write(buf)
}
func alternatives(w h.ResponseWriter, value any, send bool) {
	buf, _ := std.Marshal(value) // rejected
	switch send {
	case false:
		buf = []byte("unrelated")
	case true:
		_, _ = w.Write(buf)
	}
}
func conditionalInitializer(w h.ResponseWriter, value any, send bool) {
	buf, _ := std.Marshal(value) // rejected
	if send {
		save(buf)
	} else if buf = []byte("unrelated"); len(buf) == 0 {
		return
	}
	_, _ = w.Write(buf)
}
`
	fset := token.NewFileSet()
	syntax, err := parser.ParseFile(fset, "probe.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	file := &sourceFile{syntax: syntax, imports: (&sourceTree{}).importNames(syntax)}
	var want, found []int
	for i, line := range strings.Split(source, "\n") {
		if strings.HasSuffix(line, "// rejected") {
			want = append(want, i+1)
		}
	}
	for _, pos := range answerEncodingViolations(file) {
		found = append(found, fset.Position(pos).Line)
	}
	if !slices.Equal(found, want) {
		t.Fatalf("response encoding violations on lines %v, want %v", found, want)
	}
}

// TestAnswersWriteIdentifiersAsStrings detects alternate JSON encoders at
// HTTP writes, not uses of encoding/json for persisted data.
func TestAnswersWriteIdentifiersAsStrings(t *testing.T) {
	t.Parallel()
	tree := loadSourceTree(t, backendRoot(t))
	var violations []string
	for _, pkg := range tree.packages {
		if strings.HasPrefix(pkg.path, backendModulePath+"/api/testutil") ||
			pkg.path == backendModulePath+"/test" {
			continue
		}
		for _, file := range pkg.files {
			for _, pos := range answerEncodingViolations(file) {
				violations = append(violations, tree.fset.Position(pos).String())
			}
		}
	}
	sort.Strings(violations)
	if len(violations) > 0 {
		t.Errorf("answers bypass the identifier encoding; use common.RenderJSON or package wire:\n%s", strings.Join(violations, "\n"))
	}
}

//nolint:staticcheck // Only parser-resolved local bindings are needed for this source check.
type answerBinding = ast.Object

type answerAssignment struct {
	target *answerBinding
	value  ast.Expr
	block  ast.Node
}

// Bindings, not names, preserve captured writers and distinguish shadowed
// locals. Follow the marshaled bytes through assignments to the HTTP write:
// a handler can persist different JSON without sending it in the answer.
func answerEncodingViolations(file *sourceFile) []token.Pos {
	flow := answerEncodingFlow{
		file: file, writers: map[*answerBinding]bool{}, encoders: map[*answerBinding]string{},
		marshaled: map[*answerBinding][]token.Pos{}, assignments: map[*answerBinding][]answerAssignment{},
		blocks: map[token.Pos]ast.Node{},
	}
	var assignments []answerAssignment
	var calls []*ast.CallExpr
	remember := func(target ast.Expr, value ast.Expr, block ast.Node) {
		if binding := bindingOf(target); binding != nil {
			assignment := answerAssignment{binding, value, block}
			assignments = append(assignments, assignment)
			flow.assignments[binding] = append(flow.assignments[binding], assignment)
		}
	}
	ast.PreorderStack(file.syntax, nil, func(node ast.Node, stack []ast.Node) bool {
		switch expr := node.(type) {
		case *ast.Ident:
			if expr.Obj != nil {
				flow.blocks[expr.Pos()] = containingAnswerBlock(stack)
			}
		case *ast.FuncType:
			for _, field := range expr.Params.List {
				if name, _ := importedName(file, field.Type, netHTTPPackagePath); name == "ResponseWriter" {
					for _, parameter := range field.Names {
						if parameter.Obj != nil {
							flow.writers[parameter.Obj] = true
						}
					}
				}
			}
		case *ast.AssignStmt:
			for i, value := range expr.Rhs {
				if i < len(expr.Lhs) {
					remember(expr.Lhs[i], value, containingAnswerBlock(stack))
				}
			}
		case *ast.ValueSpec:
			for i, name := range expr.Names {
				if i < len(expr.Values) {
					remember(name, expr.Values[i], containingAnswerBlock(stack))
				}
			}
		case *ast.CallExpr:
			calls = append(calls, expr)
		}
		return true
	})
	// A file-level variable or closure may refer to a value bound later in
	// the file. Collect possible flows to a fixed point.
	for changed := true; changed; {
		changed = false
		for _, assignment := range assignments {
			marked := flow.propagate(assignment)
			changed = changed || marked
		}
	}
	var violations []token.Pos
	for _, call := range calls {
		violations = append(violations, flow.violations(call)...)
	}
	slices.Sort(violations)
	return slices.Compact(violations)
}

type answerEncodingFlow struct {
	file        *sourceFile
	writers     map[*answerBinding]bool
	encoders    map[*answerBinding]string
	marshaled   map[*answerBinding][]token.Pos
	assignments map[*answerBinding][]answerAssignment
	blocks      map[token.Pos]ast.Node
}

func containingAnswerBlock(stack []ast.Node) ast.Node {
	for i := len(stack) - 1; i >= 0; i-- {
		switch block := stack[i].(type) {
		case *ast.BlockStmt, *ast.CaseClause, *ast.CommClause,
			*ast.IfStmt, *ast.ForStmt, *ast.RangeStmt, *ast.SwitchStmt, *ast.TypeSwitchStmt:
			return block
		}
	}
	return nil
}

func bindingOf(expr ast.Expr) *answerBinding {
	if id, ok := ast.Unparen(expr).(*ast.Ident); ok {
		return id.Obj
	}
	return nil
}

func (f *answerEncodingFlow) propagate(assignment answerAssignment) bool {
	target, value := assignment.target, assignment.value
	changed := false
	if !f.writers[target] && f.writers[bindingOf(value)] {
		f.writers[target] = true
		changed = true
	}
	if name := f.encodingName(value); name != "" && f.encoders[target] == "" {
		f.encoders[target] = name
		changed = true
	}
	for _, pos := range f.marshalSources(value) {
		if !slices.Contains(f.marshaled[target], pos) {
			f.marshaled[target] = append(f.marshaled[target], pos)
			changed = true
		}
	}
	return changed
}

func (f *answerEncodingFlow) violations(call *ast.CallExpr) []token.Pos {
	encoding := f.encodingName(call.Fun)
	toWriter := len(call.Args) > 0 && f.writers[bindingOf(call.Args[0])]
	if encoding == "chiJSON" || toWriter && (encoding == "NewEncoder" || encoding == "MarshalWrite") {
		return []token.Pos{call.Pos()}
	}
	var payload []ast.Expr
	if selector, ok := ast.Unparen(call.Fun).(*ast.SelectorExpr); ok && selector.Sel.Name == "Write" && f.writers[bindingOf(selector.X)] {
		payload = call.Args
	}
	if toWriter {
		ioName, _ := importedName(f.file, call.Fun, "io")
		fmtName, _ := importedName(f.file, call.Fun, "fmt")
		if ioName == "WriteString" || ioName == "Copy" || strings.HasPrefix(fmtName, "Fprint") {
			payload = call.Args[1:]
		}
	}
	var violations []token.Pos
	for _, value := range payload {
		violations = append(violations, f.marshalSources(value)...)
	}
	return violations
}

func (f *answerEncodingFlow) marshalSources(expr ast.Expr) []token.Pos {
	switch value := ast.Unparen(expr).(type) {
	case *ast.Ident:
		// A last assignment in the same straight-line block replaces the
		// old bytes. Across branches and closures, keep possible sources.
		block := f.blocks[value.Pos()]
		assignments := f.assignments[value.Obj]
		for i := len(assignments) - 1; i >= 0; i-- {
			assignment := assignments[i]
			if assignment.value.End() <= value.Pos() {
				if block != nil && assignment.block == block {
					return f.marshalSources(assignment.value)
				}
				break
			}
		}
		return f.marshaled[value.Obj]
	case *ast.SliceExpr:
		return f.marshalSources(value.X)
	case *ast.CallExpr:
		if name := f.encodingName(value.Fun); name == "Marshal" || name == "MarshalIndent" {
			return []token.Pos{value.Pos()}
		}
		if len(value.Args) == 0 {
			return nil
		}
		name := identName(ast.Unparen(value.Fun))
		reader, _ := importedName(f.file, value.Fun, "bytes")
		_, sliceConversion := ast.Unparen(value.Fun).(*ast.ArrayType)
		if name == "append" || name == "string" || reader == "NewReader" || sliceConversion {
			var sources []token.Pos
			for _, arg := range value.Args {
				sources = append(sources, f.marshalSources(arg)...)
			}
			return sources
		}
	}
	return nil
}

func (f *answerEncodingFlow) encodingName(expr ast.Expr) string {
	expr = ast.Unparen(expr)
	if selector, ok := expr.(*ast.SelectorExpr); ok && bindingOf(selector.X) != nil {
		return ""
	}
	if name, _ := importedName(f.file, expr, chiRenderPackagePath); name == "JSON" {
		return "chiJSON"
	}
	for _, pkg := range []string{"encoding/json", "encoding/json/v2", "encoding/json/jsontext"} {
		if name, ok := importedName(f.file, expr, pkg); ok {
			return name
		}
	}
	return f.encoders[bindingOf(expr)]
}
