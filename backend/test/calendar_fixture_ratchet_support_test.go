package test

import (
	"go/ast"
	"io/fs"
	pathpkg "path"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Test-support packages (#4027 gap e): fixture files such as
// test/enrollment_audience_fixture.go have no _test.go suffix, yet every
// test that imports the package runs their dates. The scanner reads the
// non-test files of these packages like test files and resolves calls into
// them from importing packages (gap c: testpkg.TodayDate()).

type calendarHelperDiscovery struct {
	root         string
	helpers      calendarPackageHelpers
	candidates   map[string][]calendarHelperCandidate
	packageNames map[string]string // directory -> name of its non-test package
	imports      map[string][]calendarSupportImport
}

type calendarSupportImport struct {
	name string // explicit import name; empty uses the package name
	dir  string
}

func walkCalendarScannedFiles(root string, visit func(path string) error) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if skipCalendarFixtureDir(entry) {
				return filepath.SkipDir
			}
			return nil
		}
		if !calendarScannedFile(root, path) {
			return nil
		}
		return visit(path)
	})
}

// calendarScannedFile selects test files and the non-test Go files of
// test-support packages.
func calendarScannedFile(root, path string) bool {
	if strings.HasSuffix(path, "_test.go") {
		return true
	}
	return strings.HasSuffix(path, ".go") && calendarTestSupportDir(root, filepath.Dir(path))
}

// calendarTestSupportDir is the shared test package backend/test with its
// subpackages, and packages named for tests (api/testutil,
// tenant/tenanttest, modules/timetable/fixturetest, …).
func calendarTestSupportDir(root, dir string) bool {
	rel, err := filepath.Rel(root, dir)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	base := pathpkg.Base(rel)
	return rel == "test" || strings.HasPrefix(rel, "test/") ||
		strings.HasSuffix(base, "test") || strings.HasSuffix(base, "testutil")
}

func (d *calendarHelperDiscovery) recordImports(key string, file *ast.File) {
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil || !strings.HasPrefix(importPath, backendModulePath) {
			continue
		}
		dir := filepath.Join(d.root, filepath.FromSlash(strings.TrimPrefix(importPath, backendModulePath)))
		if !calendarTestSupportDir(d.root, dir) {
			continue
		}
		name := ""
		if spec.Name != nil {
			name = spec.Name.Name
		}
		d.imports[key] = append(d.imports[key], calendarSupportImport{name: name, dir: filepath.Clean(dir)})
	}
}

// resolveImports maps each import name to the package key of its scanned
// test-support package; imports of unscanned packages are dropped.
func (d *calendarHelperDiscovery) resolveImports() {
	for key, imports := range d.imports {
		for _, imported := range imports {
			packageName, ok := d.packageNames[imported.dir]
			name := imported.name
			if name == "" {
				name = packageName
			}
			if !ok || name == "_" || name == "." {
				continue
			}
			if d.helpers.imports[key] == nil {
				d.helpers.imports[key] = map[string]string{}
			}
			d.helpers.imports[key][name] = calendarPackageKey(filepath.Join(imported.dir, "x.go"), packageName)
		}
	}
}

// calendarImportedIdentity is the identity a consumer uses for a provider
// helper: pkg.Function for functions, the unchanged Type.Method or
// Factory().Method for methods, whose receiver type the consumer infers
// without the package name. Unexported functions are not reachable.
func calendarImportedIdentity(name, identity string) (string, bool) {
	if strings.Contains(identity, ".") {
		return identity, true
	}
	first, _ := utf8.DecodeRuneInString(identity)
	return name + "." + identity, unicode.IsUpper(first)
}

func linkCalendarImportedCandidates(helpers calendarPackageHelpers) {
	for key, imports := range helpers.imports {
		if helpers.candidates[key] == nil {
			// A package of test functions only declares no candidate itself.
			helpers.candidates[key] = map[string][]calendarHelperCandidate{}
		}
		for name, provider := range imports {
			for identity, matches := range helpers.candidates[provider] {
				imported, ok := calendarImportedIdentity(name, identity)
				if ok && len(helpers.candidates[key][imported]) == 0 {
					helpers.candidates[key][imported] = matches
				}
			}
			copyCalendarImportedPositions(helpers.effectiveParams, key, name, provider)
		}
	}
}

// syncCalendarImportedHelpers copies the provider registers into every
// importing package. It only adds facts, so the fixed points converge.
func syncCalendarImportedHelpers(helpers calendarPackageHelpers) {
	for key, imports := range helpers.imports {
		for name, provider := range imports {
			candidates := helpers.candidates[provider]
			copyCalendarImportedFlags(helpers.dates, key, name, provider, calendarResultFilter(candidates, calendarDateResult))
			copyCalendarImportedFlags(helpers.instants, key, name, provider, calendarResultFilter(candidates, calendarInstantResult))
			copyCalendarImportedFlags(helpers.weekly, key, name, provider, calendarResultFilter(candidates, calendarInstantResult))
			copyCalendarImportedFlags(helpers.scalars, key, name, provider, calendarResultFilter(candidates, calendarNumberResult))
			copyCalendarImportedFlags(helpers.weekdays, key, name, provider, calendarResultFilter(candidates, calendarNumberResult))
			copyCalendarImportedFlags(helpers.shifted, key, name, provider, nil)
			copyCalendarImportedPositions(helpers.shiftSinks, key, name, provider)
			copyCalendarImportedPositions(helpers.shiftPassthrough, key, name, provider)
		}
	}
}

// copyCalendarImportedFlags copies the facts of provider helpers that pass
// accept (nil accepts all). Fixtures that return a row are skipped: a row
// created on the live day is no live date itself, and its ID or name in an
// expectation does not depend on the clock.
func copyCalendarImportedFlags(flags map[string]map[string]bool, key, name, provider string, accept func(string) bool) {
	if flags[key] == nil {
		return
	}
	for identity, live := range flags[provider] {
		imported, ok := calendarImportedIdentity(name, identity)
		if accept != nil && !accept(identity) {
			continue
		}
		if live && ok {
			flags[key][imported] = true
		}
	}
}

func copyCalendarImportedPositions(registers map[string]map[string]map[int]bool, key, name, provider string) {
	if registers[key] == nil {
		registers[key] = map[string]map[int]bool{}
	}
	for identity, positions := range registers[provider] {
		imported, ok := calendarImportedIdentity(name, identity)
		if !ok {
			continue
		}
		for position := range positions {
			markEffectiveParameterSink(registers[key], imported, position)
		}
	}
}

// calendarFunctionValueAliases turns package-level function values such as
// `var TodayDate = timezone.TodayDate` (gap c) into helper declarations
// `func TodayDate() { return timezone.TodayDate() }`, so calls through the
// alias propagate like calls to a declared helper.
func calendarFunctionValueAliases(file *ast.File) []*ast.FuncDecl {
	var aliases []*ast.FuncDecl
	for _, declaration := range file.Decls {
		general, ok := declaration.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range general.Specs {
			aliases = append(aliases, calendarValueSpecAliases(spec)...)
		}
	}
	return aliases
}

func calendarValueSpecAliases(spec ast.Spec) []*ast.FuncDecl {
	value, ok := spec.(*ast.ValueSpec)
	if !ok {
		return nil
	}
	var aliases []*ast.FuncDecl
	for i, name := range value.Names {
		if i >= len(value.Values) || name.Name == "_" || !calendarFunctionReference(value.Values[i]) {
			continue
		}
		call := &ast.CallExpr{Fun: value.Values[i]}
		aliases = append(aliases, &ast.FuncDecl{
			Name: ast.NewIdent(name.Name),
			Type: &ast.FuncType{Params: &ast.FieldList{}},
			Body: &ast.BlockStmt{List: []ast.Stmt{&ast.ReturnStmt{Results: []ast.Expr{call}}}},
		})
	}
	return aliases
}

func calendarFunctionReference(expr ast.Expr) bool {
	switch value := expr.(type) {
	case *ast.Ident:
		return true
	case *ast.SelectorExpr:
		_, named := value.X.(*ast.Ident)
		return named
	default:
		return false
	}
}

// calendarValuePackages transform a value without being code under test:
// formatting, encoding, request construction and assertions.
var calendarValuePackages = map[string]bool{
	"bytes": true, "encoding/json": true, "errors": true, "fmt": true, "io": true, "maps": true,
	"math": true, "net/http": true, "net/http/httptest": true, "net/url": true, "slices": true,
	"sort": true, "strconv": true, "strings": true, "time": true,
}

func calendarValuePackageNames(file *ast.File) map[string]bool {
	packages := map[string]bool{}
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil || !calendarValueImport(importPath) {
			continue
		}
		name := pathpkg.Base(importPath)
		if spec.Name != nil {
			name = spec.Name.Name
		}
		packages[name] = true
	}
	return packages
}

func calendarValueImport(importPath string) bool {
	return calendarValuePackages[importPath] || strings.HasSuffix(importPath, "/sharedkernel/calendar") ||
		strings.HasSuffix(importPath, "/testify/assert") || strings.HasSuffix(importPath, "/testify/require")
}

// calendarResultFilter accepts provider helpers whose first result has a
// type of the register, and helpers without results (function value
// aliases such as `var TodayDate = calendar.TodayDate`).
func calendarResultFilter(candidates map[string][]calendarHelperCandidate, accepts func(string) bool) func(string) bool {
	return func(identity string) bool {
		for _, candidate := range candidates[identity] {
			results := candidate.fn.Type.Results
			if results != nil && len(results.List) > 0 && !accepts(expressionName(results.List[0].Type)) {
				return false
			}
		}
		return true
	}
}

func calendarDateResult(typeName string) bool {
	return typeName == "string" || strings.HasSuffix(typeName, "Date")
}

func calendarInstantResult(typeName string) bool { return typeName == "Time" }

func calendarNumberResult(typeName string) bool {
	return typeName == "int" || typeName == "int64" || typeName == "Weekday" || typeName == "Duration"
}
