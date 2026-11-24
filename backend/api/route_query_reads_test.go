package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/contract"
)

// handlerQueryReadsOutsideContract are the query parameters a handler reads
// that the contract of its route does not register (#7563). The portal's
// catalog proxy forwards only registered parameters, so a browser that sends
// one of these loses it without an error. No client sends them through the
// catalog (checked on 2026-11-20).
//
// Shrink only: register the parameter (when a client sends it) or stop
// reading it, then delete it here.
var handlerQueryReadsOutsideContract = map[string][]string{
	// ?format=pdf stays for existing calls (ADR 0270, public files)
	"GET /api/enrollment/requests/{statusToken}": {"format"},
}

// checkHandlerQueryReadsAreRegistered holds every query parameter a route's
// handler reads, found in its source, against the route's `query`. It walks
// the real router for each registered route's handler function and follows
// its calls through the backend source: url.Values reads with a constant key
// (Get, Has, index; FormValue on a route without a body), also through
// helpers that take the key, the request or the values as a parameter.
//
// It does not see a handler a builder closure hides (common.IDAction and
// relatives read no query), keys built at run time, calls through interfaces,
// function values or fields, and methods of another receiver.
func checkHandlerQueryReadsAreRegistered(t *testing.T, apiInstance *goldenRuntime) {
	t.Parallel()
	doc, err := ContractDocument()
	require.NoError(t, err)
	handlers := map[string]string{}
	require.NoError(t, chi.Walk(apiInstance.router, func(method, route string, handler http.Handler, _ ...func(http.Handler) http.Handler) error {
		if name := handlerFuncName(handler); name != "" {
			handlers[method+" "+route] = name
		}
		return nil
	}))
	index := newQueryReadIndex(t)
	unregistered := map[string][]string{}
	var untypedIDs []string
	for _, route := range doc.Routes {
		name, found := handlers[route.Key()]
		if !found {
			continue
		}
		registered := map[string]bool{}
		for _, param := range route.Query {
			registered[param.Name] = true
		}
		if route.Variants != nil {
			registered[route.Variants.QueryParam] = true
		}
		// FormValue reads the form body first; only a route without one
		// reads it from the query.
		bodiless := route.Request == nil && !route.Multipart
		reads := index.handlerQuery(name)
		if missed := reads.unregistered(registered, bodiless); len(missed) > 0 {
			unregistered[route.Key()] = missed
		}
		for _, param := range route.Query {
			if param.Kind == "string" && param.TextReason == "" && reads.idKeys[param.Name] {
				untypedIDs = append(untypedIDs, route.Key()+" ?"+param.Name)
			}
		}
	}
	assertQueryReadBaseline(t, unregistered, doc.Routes)
	assert.Empty(t, untypedIDs, "queries parsed as IDs need QueryID or a documented text alternative")
}

func assertQueryReadBaseline(t *testing.T, found map[string][]string, routes []contract.Route) {
	t.Helper()
	var unexpected, stale []string
	for key, params := range found {
		for _, param := range params {
			if !containsString(handlerQueryReadsOutsideContract[key], param) {
				unexpected = append(unexpected, key+" ?"+param)
			}
		}
	}
	registered := map[string]bool{}
	for _, route := range routes {
		registered[route.Key()] = true
	}
	for key, params := range handlerQueryReadsOutsideContract {
		for _, param := range params {
			if !registered[key] || !containsString(found[key], param) {
				stale = append(stale, key+" ?"+param)
			}
		}
	}
	sort.Strings(unexpected)
	sort.Strings(stale)
	assert.Emptyf(t, unexpected, "these handlers read query parameters their route does not register; the catalog proxy drops them. Add them to the route's Query (common.RouteContract) and run gencontract, or stop reading them:\n%s", strings.Join(unexpected, "\n"))
	assert.Emptyf(t, stale, "these entries of handlerQueryReadsOutsideContract no longer apply; delete them:\n%s", strings.Join(stale, "\n"))
}

func containsString(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

func TestQueryReadGuardTracksAliasedUnregisteredID(t *testing.T) {
	t.Parallel()

	source, err := parser.ParseFile(token.NewFileSet(), "probe.go", `package probe
import numbers "strconv"
func endpoint(request *http.Request) {
	values := request.URL.Query()
	alias := values
	keys := []string{"hidden"}
	for _, key := range keys {
		value := alias.Get(key)
		consume(value)
	}
}
func consume(value string) {
	_, _ = numbers.ParseInt(value, 10, 64)
}
`, 0)
	require.NoError(t, err)
	pkg := &queryReadPackage{funcs: map[string]*ast.FuncDecl{}, imports: map[*ast.FuncDecl]map[string]string{}}
	for _, decl := range source.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			pkg.funcs[fn.Name.Name] = fn
			pkg.imports[fn] = queryReadFileImports(source)
		}
	}
	ix := newQueryReadIndex(t)
	handler := pkg.funcs["endpoint"]
	reads := ix.analyze(pkg, handler, handler)
	assert.Equal(t, []string{"hidden"}, reads.unregistered(map[string]bool{"other": true}, true))
	assert.Empty(t, reads.unregistered(map[string]bool{"hidden": true}, true))
	assert.True(t, reads.idKeys["hidden"], "a QueryString would pass a bigint to the parser")
}

// handlerFuncName is the Go name of a handler function, as the runtime knows
// it: "<package path>.(*Resource).list-fm".
func handlerFuncName(handler http.Handler) string {
	value := reflect.ValueOf(handler)
	if value.Kind() != reflect.Func {
		return ""
	}
	fn := runtime.FuncForPC(value.Pointer())
	if fn == nil {
		return ""
	}
	return fn.Name()
}

const backendModulePath = "github.com/moto-ogs/project-phoenix"

// queryReadIndex reads the backend source one package at a time.
type queryReadIndex struct {
	// pkg parses a backend package on its first use and remembers it; nil
	// for a package outside the module or without a directory.
	pkg     func(pkgPath string) *queryReadPackage
	results map[ast.Node]*queryReadResult
}

type queryReadPackage struct {
	path    string
	funcs   map[string]*ast.FuncDecl // functions by name
	methods map[string]*ast.FuncDecl // methods by "Type.name"
	imports map[*ast.FuncDecl]map[string]string
	consts  map[string]string // string constants by name
}

// queryReadResult is what a function reads: constant keys, keys read by
// FormValue, and the parameters it reads as a key.
type queryReadResult struct {
	keys        map[string]bool
	formKeys    map[string]bool
	keyedParams map[int]bool
	formParams  map[int]bool
	idKeys      map[string]bool
	idParams    map[int]bool
	parsed      map[int]bool
}

func newQueryReadIndex(t *testing.T) *queryReadIndex {
	wd, err := os.Getwd()
	require.NoError(t, err)
	root := filepath.Dir(wd)
	packages := map[string]*queryReadPackage{}
	load := func(pkgPath string) *queryReadPackage {
		if pkg, found := packages[pkgPath]; found {
			return pkg
		}
		packages[pkgPath] = nil
		pkg := loadQueryReadPackage(t, root, pkgPath)
		packages[pkgPath] = pkg
		return pkg
	}
	return &queryReadIndex{pkg: load, results: map[ast.Node]*queryReadResult{}}
}

// handlerReads lists the keys the function the runtime names reads.
func (ix *queryReadIndex) handlerQuery(runtimeName string) *queryReadResult {
	name := splitRuntimeName(runtimeName)
	pkg := ix.pkg(name.pkgPath)
	if pkg == nil {
		return &queryReadResult{}
	}
	decl := pkg.funcs[name.funcName]
	if name.recvType != "" {
		decl = pkg.methods[name.recvType+"."+name.funcName]
	}
	if decl == nil {
		return &queryReadResult{}
	}
	return ix.analyze(pkg, decl, closureAt(decl, name.closure))
}

func (result *queryReadResult) names(withForm bool) []string {
	seen := map[string]bool{}
	for key := range result.keys {
		seen[key] = true
	}
	if withForm {
		for key := range result.formKeys {
			seen[key] = true
		}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (result *queryReadResult) unregistered(registered map[string]bool, withForm bool) []string {
	var missing []string
	for _, key := range result.names(withForm) {
		if !registered[key] {
			missing = append(missing, key)
		}
	}
	return missing
}

type runtimeFuncName struct {
	pkgPath, recvType, funcName string
	// closure numbers the function literal inside funcName: "F.func2.1" is
	// the first literal in the second literal of F, in source order.
	closure []int
}

// splitRuntimeName turns "a/b/pkg.(*R).m-fm" into ("a/b/pkg", "R", "m")
// and "a/b/pkg.F.func2.1" into ("a/b/pkg", "", "F", [2 1]).
func splitRuntimeName(name string) runtimeFuncName {
	slash := strings.LastIndex(name, "/")
	dot := strings.Index(name[slash+1:], ".")
	if dot < 0 {
		return runtimeFuncName{}
	}
	parsed := runtimeFuncName{pkgPath: name[:slash+1+dot]}
	rest := strings.Split(name[slash+2+dot:], ".")
	if strings.HasPrefix(rest[0], "(") && len(rest) > 1 {
		parsed.recvType = cleanFuncName(strings.Trim(rest[0], "(*)"))
		rest = rest[1:]
	}
	parsed.funcName = cleanFuncName(rest[0])
	for _, part := range rest[1:] {
		number, err := strconv.Atoi(strings.TrimPrefix(part, "func"))
		if err != nil {
			break
		}
		parsed.closure = append(parsed.closure, number)
	}
	return parsed
}

// closureAt is the function literal the path numbers, or the declaration
// itself when the path is empty or does not resolve.
func closureAt(decl *ast.FuncDecl, path []int) ast.Node {
	var node ast.Node = decl
	for _, number := range path {
		literals := directLiterals(node)
		if number < 1 || number > len(literals) {
			return decl
		}
		node = literals[number-1]
	}
	return node
}

// directLiterals are the function literals in node that no other literal in
// node encloses, in source order.
func directLiterals(node ast.Node) []*ast.FuncLit {
	var literals []*ast.FuncLit
	ast.Inspect(node, func(child ast.Node) bool {
		if literal, ok := child.(*ast.FuncLit); ok && child != node {
			literals = append(literals, literal)
			return false
		}
		return true
	})
	return literals
}

func cleanFuncName(name string) string {
	name = strings.TrimSuffix(name, "-fm")
	if i := strings.Index(name, "["); i >= 0 {
		name = name[:i]
	}
	return name
}

// loadQueryReadPackage parses the non-test files of a backend package.
func loadQueryReadPackage(t *testing.T, root, pkgPath string) *queryReadPackage {
	rel, inModule := strings.CutPrefix(pkgPath, backendModulePath)
	if !inModule {
		return nil
	}
	dir := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(rel, "/")))
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	funcs, methods := map[string]*ast.FuncDecl{}, map[string]*ast.FuncDecl{}
	imports, consts := map[*ast.FuncDecl]map[string]string{}, map[string]string{}
	fset := token.NewFileSet()
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		// Resolve lexical declarations: the scanner follows local aliases and
		// parameters by their declaration rather than by their spelling.
		file, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, 0)
		require.NoError(t, err)
		fileImports := queryReadFileImports(file)
		for _, decl := range file.Decls {
			if gen, isGen := decl.(*ast.GenDecl); isGen && gen.Tok == token.CONST {
				addQueryReadConsts(consts, gen)
			}
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			imports[fn] = fileImports
			if recvType, _ := receiver(fn); recvType != "" {
				methods[recvType+"."+fn.Name.Name] = fn
			} else {
				funcs[fn.Name.Name] = fn
			}
		}
	}
	return &queryReadPackage{path: pkgPath, funcs: funcs, methods: methods, imports: imports, consts: consts}
}

// queryReadFileImports maps the names a file imports to their paths.
func queryReadFileImports(file *ast.File) map[string]string {
	imports := map[string]string{}
	for _, spec := range file.Imports {
		path, _ := strconv.Unquote(spec.Path.Value)
		name := path[strings.LastIndex(path, "/")+1:]
		if spec.Name != nil {
			name = spec.Name.Name
		}
		imports[name] = path
	}
	return imports
}

// addQueryReadConsts adds the string constants of a declaration to consts.
func addQueryReadConsts(consts map[string]string, gen *ast.GenDecl) {
	for _, spec := range gen.Specs {
		value, ok := spec.(*ast.ValueSpec)
		if !ok {
			continue
		}
		for i, name := range value.Names {
			if i >= len(value.Values) {
				break
			}
			if lit, isLit := value.Values[i].(*ast.BasicLit); isLit && lit.Kind == token.STRING {
				consts[name.Name], _ = strconv.Unquote(lit.Value)
			}
		}
	}
}

// receiver is the type name and the variable name of a method's receiver.
func receiver(fn *ast.FuncDecl) (string, string) {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return "", ""
	}
	field := fn.Recv.List[0]
	typ := field.Type
	if star, ok := typ.(*ast.StarExpr); ok {
		typ = star.X
	}
	switch generic := typ.(type) {
	case *ast.IndexExpr:
		typ = generic.X
	case *ast.IndexListExpr:
		typ = generic.X
	}
	ident, ok := typ.(*ast.Ident)
	if !ok {
		return "", ""
	}
	name := ""
	if len(field.Names) > 0 {
		name = field.Names[0].Name
	}
	return ident.Name, name
}

// analyze reads node, a declaration or a function literal inside decl.
func (ix *queryReadIndex) analyze(pkg *queryReadPackage, decl *ast.FuncDecl, node ast.Node) *queryReadResult {
	if result, done := ix.results[node]; done {
		return result
	}
	result := &queryReadResult{keys: map[string]bool{}, formKeys: map[string]bool{}, keyedParams: map[int]bool{}, formParams: map[int]bool{},
		idKeys: map[string]bool{}, idParams: map[int]bool{}, parsed: map[int]bool{}}
	ix.results[node] = result // a recursive call sees what is known so far
	fnType, body := decl.Type, decl.Body
	if literal, ok := node.(*ast.FuncLit); ok {
		fnType, body = literal.Type, literal.Body
	}
	recvType, recvName := receiver(decl)
	scan := &queryReadScan{ix: ix, pkg: pkg, imports: pkg.imports[decl], result: result, params: paramIndexes(fnType), values: valuesParams(fnType, pkg.imports[decl]), recvType: recvType, recvName: recvName,
		assignments: queryAssignments(body)}
	ast.Inspect(body, scan.visit)
	return result
}

func paramIndexes(fnType *ast.FuncType) map[token.Pos]int {
	indexes := map[token.Pos]int{}
	position := 0
	for _, field := range fnType.Params.List {
		if len(field.Names) == 0 {
			position++
			continue
		}
		for _, name := range field.Names {
			indexes[queryBinding(name)] = position
			position++
		}
	}
	return indexes
}

// valuesParams are the parameters of type url.Values.
func valuesParams(fnType *ast.FuncType, imports map[string]string) map[token.Pos]bool {
	values := map[token.Pos]bool{}
	for _, field := range fnType.Params.List {
		sel, ok := field.Type.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Values" {
			continue
		}
		qualifier, ok := sel.X.(*ast.Ident)
		if !ok || imports[qualifier.Name] != "net/url" {
			continue
		}
		for _, name := range field.Names {
			values[queryBinding(name)] = true
		}
	}
	return values
}

// queryBinding identifies a local by its declaration, not by its spelling.
func queryBinding(id *ast.Ident) token.Pos {
	if id.Obj == nil {
		return token.NoPos
	}
	return id.Obj.Pos()
}

type queryReadScan struct {
	ix          *queryReadIndex
	pkg         *queryReadPackage
	imports     map[string]string
	result      *queryReadResult
	params      map[token.Pos]int
	values      map[token.Pos]bool // parameters holding url.Values
	assignments map[token.Pos][]ast.Expr
	recvType    string
	recvName    string
}

func queryAssignments(body *ast.BlockStmt) map[token.Pos][]ast.Expr {
	values := map[token.Pos][]ast.Expr{}
	remember := func(left ast.Expr, right ast.Expr) {
		if id, ok := left.(*ast.Ident); ok {
			if origin := queryBinding(id); origin.IsValid() {
				values[origin] = append(values[origin], right)
			}
		}
	}
	ast.Inspect(body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			for i, left := range n.Lhs {
				if len(n.Rhs) == 1 {
					remember(left, n.Rhs[0])
				} else if i < len(n.Rhs) {
					remember(left, n.Rhs[i])
				}
			}
		case *ast.ValueSpec:
			for i, name := range n.Names {
				if i < len(n.Values) {
					remember(name, n.Values[i])
				}
			}
		case *ast.RangeStmt:
			remember(n.Value, n.X)
		}
		return true
	})
	return values
}

func (s *queryReadScan) visit(node ast.Node) bool {
	switch n := node.(type) {
	case *ast.IndexExpr:
		if s.isValues(n.X) {
			s.readKey(n.Index, false)
		}
	case *ast.CallExpr:
		s.call(n)
	}
	return true
}

// isQueryCall reports `<x>.URL.Query()`.
func isQueryCall(expr ast.Expr) bool {
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Query" {
		return false
	}
	inner, ok := sel.X.(*ast.SelectorExpr)
	return ok && inner.Sel.Name == "URL"
}

func (s *queryReadScan) isValues(expr ast.Expr) bool {
	return s.isValuesOrigin(ast.Unparen(expr), map[token.Pos]bool{})
}

func (s *queryReadScan) isValuesOrigin(expr ast.Expr, visited map[token.Pos]bool) bool {
	ident, ok := expr.(*ast.Ident)
	if !ok {
		return isQueryCall(expr)
	}
	origin := queryBinding(ident)
	if !origin.IsValid() || visited[origin] {
		return false
	}
	visited[origin] = true
	if s.values[origin] {
		return true
	}
	for _, value := range s.assignments[origin] {
		if s.isValuesOrigin(ast.Unparen(value), visited) {
			return true
		}
	}
	return false
}

func (s *queryReadScan) call(call *ast.CallExpr) {
	if s.parsesIdentifier(call) {
		s.idSource(call.Args[0], map[ast.Expr]bool{})
	}
	if sel, isSel := call.Fun.(*ast.SelectorExpr); isSel && len(call.Args) > 0 {
		switch {
		case (sel.Sel.Name == "Get" || sel.Sel.Name == "Has") && s.isValues(sel.X):
			s.readKey(call.Args[0], false)
			return
		case sel.Sel.Name == "FormValue":
			s.readKey(call.Args[0], true)
			return
		}
	}
	callee, calleePkg := s.resolve(call.Fun)
	if callee == nil {
		return
	}
	result := s.ix.analyze(calleePkg, callee, callee)
	for key := range result.keys {
		s.result.keys[key] = true
	}
	for key := range result.formKeys {
		s.result.formKeys[key] = true
	}
	for key := range result.idKeys {
		s.result.idKeys[key] = true
	}
	for position := range result.idParams {
		if position < len(call.Args) {
			s.recordKey(call.Args[position], s.result.idKeys, s.result.idParams)
		}
	}
	for position := range result.parsed {
		if position < len(call.Args) {
			s.idSource(call.Args[position], map[ast.Expr]bool{})
		}
	}
	for position := range result.keyedParams {
		if position < len(call.Args) {
			s.readKey(call.Args[position], false)
		}
	}
	for position := range result.formParams {
		if position < len(call.Args) {
			s.readKey(call.Args[position], true)
		}
	}
}

func (s *queryReadScan) parsesIdentifier(call *ast.CallExpr) bool {
	sel, ok := ast.Unparen(call.Fun).(*ast.SelectorExpr)
	if !ok || len(call.Args) == 0 {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	path := s.imports[pkg.Name]
	if path == backendModulePath+"/sharedkernel/ident" {
		return strings.HasPrefix(sel.Sel.Name, "Parse")
	}
	if path != "strconv" || len(call.Args) != 3 || (sel.Sel.Name != "ParseInt" && sel.Sel.Name != "ParseUint") {
		return false
	}
	width, literal := ast.Unparen(call.Args[2]).(*ast.BasicLit)
	return literal && width.Value == "64"
}

// idSource follows the value fed into an ID parser, through aliases,
// splitting/normalizing calls and arguments of backend helper functions.
func (s *queryReadScan) idSource(expr ast.Expr, seen map[ast.Expr]bool) {
	expr = ast.Unparen(expr)
	if expr == nil || seen[expr] {
		return
	}
	seen[expr] = true
	switch found := expr.(type) {
	case *ast.Ident:
		origin := queryBinding(found)
		if position, parameter := s.params[origin]; parameter {
			s.result.parsed[position] = true
		}
		for _, value := range s.assignments[origin] {
			s.idSource(value, seen)
		}
	case *ast.IndexExpr:
		if s.isValues(found.X) {
			s.recordKey(found.Index, s.result.idKeys, s.result.idParams)
		} else {
			s.idSource(found.X, seen)
		}
	case *ast.CallExpr:
		if sel, ok := found.Fun.(*ast.SelectorExpr); ok && len(found.Args) == 1 && sel.Sel.Name == "Get" && s.isValues(sel.X) {
			s.recordKey(found.Args[0], s.result.idKeys, s.result.idParams)
			return
		}
		for _, arg := range found.Args {
			s.idSource(arg, seen)
		}
	}
}

// readKey records a key: a constant string, or a parameter of the function.
func (s *queryReadScan) readKey(expr ast.Expr, form bool) {
	keys, params := s.result.keys, s.result.keyedParams
	if form {
		keys, params = s.result.formKeys, s.result.formParams
	}
	s.recordKey(expr, keys, params)
}

func (s *queryReadScan) recordKey(expr ast.Expr, keys map[string]bool, params map[int]bool) {
	s.recordKeyOrigin(ast.Unparen(expr), keys, params, map[token.Pos]bool{})
}

func (s *queryReadScan) recordKeyOrigin(expr ast.Expr, keys map[string]bool, params map[int]bool, visited map[token.Pos]bool) {
	switch key := expr.(type) {
	case *ast.BasicLit:
		if value, err := strconv.Unquote(key.Value); err == nil && key.Kind == token.STRING {
			keys[value] = true
		}
	case *ast.Ident:
		origin := queryBinding(key)
		if origin.IsValid() && visited[origin] {
			return
		}
		visited[origin] = true
		if position, isParam := s.params[origin]; isParam {
			params[position] = true
		} else if value, isConst := s.pkg.consts[key.Name]; isConst {
			keys[value] = true
		}
		for _, assigned := range s.assignments[origin] {
			s.recordKeyOrigin(ast.Unparen(assigned), keys, params, visited)
		}
	case *ast.SelectorExpr:
		if ident, ok := key.X.(*ast.Ident); ok {
			if pkg := s.ix.pkg(s.imports[ident.Name]); pkg != nil {
				if value, isConst := pkg.consts[key.Sel.Name]; isConst {
					keys[value] = true
				}
			}
		}
	case *ast.CompositeLit:
		// Query names can come from a fixed collection, for example the
		// two run kinds whose DATEV filters are read in a loop.
		for _, element := range key.Elts {
			if entry, ok := element.(*ast.KeyValueExpr); ok {
				element = entry.Value
			}
			s.recordKeyOrigin(ast.Unparen(element), keys, params, visited)
		}
	}
}

// resolve finds the declaration a call reaches: a function of this package
// or of an imported backend package, or a method of this function's own
// receiver.
func (s *queryReadScan) resolve(fun ast.Expr) (*ast.FuncDecl, *queryReadPackage) {
	switch f := fun.(type) {
	case *ast.Ident:
		return s.pkg.funcs[f.Name], s.pkg
	case *ast.SelectorExpr:
		ident, ok := f.X.(*ast.Ident)
		if !ok {
			return nil, nil
		}
		if s.recvName != "" && ident.Name == s.recvName {
			return s.pkg.methods[s.recvType+"."+f.Sel.Name], s.pkg
		}
		if path, imported := s.imports[ident.Name]; imported {
			if pkg := s.ix.pkg(path); pkg != nil {
				return pkg.funcs[f.Sel.Name], pkg
			}
		}
	}
	return nil, nil
}
