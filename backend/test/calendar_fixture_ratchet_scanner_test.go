package test

import (
	"fmt"
	"go/ast"
	"go/token"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type calendarClockFinding struct {
	file     string
	function string
	line     int
	risk     string
}

type calendarFunctionScan struct {
	fn                *ast.FuncDecl
	file              string
	fset              *token.FileSet
	instantVars       calendarVariables
	scalarVars        calendarVariables
	dateVars          calendarVariables
	rangeVars         calendarVariables
	instantHelpers    map[string]bool
	scalarHelpers     map[string]bool
	weeklyHelpers     map[string]bool
	weekdayHelpers    map[string]bool
	dateHelpers       map[string]bool
	timePackages      map[string]bool
	timezonePackages  map[string]bool
	assertionPackages map[string]bool
}

type calendarPackageHelpers struct {
	dates           map[string]map[string]bool
	instants        map[string]map[string]bool
	scalars         map[string]map[string]bool
	weekly          map[string]map[string]bool
	weekdays        map[string]map[string]bool
	candidates      map[string]map[string][]calendarHelperCandidate
	effectiveParams map[string]map[string]map[int]bool
	// shifted marks helpers that return a live date or instant moved by
	// whole days; shiftSinks and shiftPassthrough hold the parameter
	// positions that reach code under test or the helper's result.
	shifted          map[string]map[string]bool
	shiftSinks       map[string]map[string]map[int]bool
	shiftPassthrough map[string]map[string]map[int]bool
	// imports maps a package key and an import name to the key of the
	// test-support package it names.
	imports map[string]map[string]string
}

//nolint:staticcheck // The scanner deliberately relies on parser-resolved local bindings.
type calendarObject = ast.Object

type calendarVariables map[*calendarObject]bool

type calendarHelperCandidate struct {
	name             string
	receiver         string
	resultType       string
	fn               *ast.FuncDecl
	timePackages     map[string]bool
	timezonePackages map[string]bool
	valuePackages    map[string]bool
}

func scanCalendarFixtureClockRisks(root string) ([]calendarClockFinding, error) {
	helpers, err := discoverCalendarPackageHelpers(root)
	if err != nil {
		return nil, err
	}
	fset := sharedGoFileSet
	var findings []calendarClockFinding
	err = walkCalendarScannedFiles(root, func(path string) error {
		found, err := scanCalendarFixtureFile(root, path, fset, helpers)
		findings = append(findings, found...)
		return err
	})
	sort.Slice(findings, func(i, j int) bool {
		return findings[i].file < findings[j].file ||
			(findings[i].file == findings[j].file && findings[i].line < findings[j].line)
	})
	if err != nil {
		return nil, err
	}
	return findings, nil
}

func applyCalendarClockExceptions(findings []calendarClockFinding, exceptions map[string]string) ([]calendarClockFinding, error) {
	matched := make(map[string]bool, len(exceptions))
	for key, reason := range exceptions {
		if strings.TrimSpace(reason) == "" {
			return nil, fmt.Errorf("calendar fixture clock exception %q requires a non-empty reason", key)
		}
	}
	kept := findings[:0]
	for _, finding := range findings {
		key := finding.file + ":" + finding.function
		if _, ok := exceptions[key]; ok {
			matched[key] = true
			continue
		}
		kept = append(kept, finding)
	}
	for key := range exceptions {
		if !matched[key] {
			return nil, fmt.Errorf("calendar fixture clock exception %q has no matching finding", key)
		}
	}
	return kept, nil
}

func skipCalendarFixtureDir(entry fs.DirEntry) bool {
	name := entry.Name()
	return name == "vendor" || name == "node_modules" || strings.HasPrefix(name, ".")
}

func scanCalendarFixtureFile(root, path string, fset *token.FileSet, helpers calendarPackageHelpers) ([]calendarClockFinding, error) {
	source, err := readGoSource(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	_, file, err := parseGoSourceCached(path, source)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		rel = path
	}
	key := calendarPackageKey(path, file.Name.Name)
	return scanCalendarFixtureFunctions(filepath.ToSlash(rel), fset, file, helpers, key), nil
}

func scanCalendarFixtureFunctions(rel string, fset *token.FileSet, file *ast.File, helpers calendarPackageHelpers, key string) []calendarClockFinding {
	timePackages, timezonePackages := timeImportNames(file)
	assertionPackages := assertionImportNames(file)
	var findings []calendarClockFinding
	for _, fn := range declaredFunctions(file) {
		if !isTestFunction(fn) {
			continue
		}
		instantVars := currentCalendarInstantVariables(fn.Body, helpers.instants[key], timePackages, timezonePackages, nil)
		scalarVars := currentLiveInstantScalarVariables(fn.Body, instantVars, helpers.scalars[key], helpers.instants[key], timePackages, timezonePackages)
		dateVars := currentCalendarDateVariables(fn.Body, helpers.dates[key], timezonePackages)
		rangeVars := currentLiveCalendarRangeVariables(fn.Body, dateVars, helpers.dates[key], timezonePackages)
		scan := calendarFunctionScan{
			fn: fn, file: rel, fset: fset,
			instantVars: instantVars, scalarVars: scalarVars, dateVars: dateVars, rangeVars: rangeVars,
			instantHelpers: helpers.instants[key], scalarHelpers: helpers.scalars[key], weeklyHelpers: helpers.weekly[key], weekdayHelpers: helpers.weekdays[key], dateHelpers: helpers.dates[key],
			timePackages: timePackages, timezonePackages: timezonePackages,
			assertionPackages: assertionPackages,
		}
		findings = append(findings, scan.findings()...)
	}
	valuePackages := calendarValuePackageNames(file)
	for _, fn := range declaredFunctions(file) {
		dateVars := currentCalendarDateVariables(fn.Body, helpers.dates[key], timezonePackages)
		findings = append(findings, findLiveEffectiveBoundaries(
			fn, rel, fset, dateVars, helpers.dates[key], timezonePackages,
			helpers.effectiveParams[key],
		)...)
		scope := newCalendarShiftScope(fn, key, helpers, timePackages, timezonePackages, valuePackages, nil)
		findings = append(findings, scope.findings(rel, fset)...)
	}
	return findings
}

func declaredFunctions(file *ast.File) []*ast.FuncDecl {
	var functions []*ast.FuncDecl
	for _, declaration := range file.Decls {
		fn, ok := declaration.(*ast.FuncDecl)
		if ok && fn.Body != nil {
			functions = append(functions, fn)
		}
	}
	return functions
}

func calendarHelperIdentity(receiver, name string) string {
	if receiver == "" {
		return name
	}
	return receiver + "." + name
}

func calendarReceiverName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return ""
	}
	return expressionName(fn.Recv.List[0].Type)
}

func calendarReceiverTypes(fn *ast.FuncDecl) map[*calendarObject]string {
	types := map[*calendarObject]string{}
	recordCalendarFieldTypes(fn.Recv, types)
	recordCalendarFieldTypes(fn.Type.Params, types)
	for changed := true; changed; {
		changed = recordCalendarAssignedTypes(fn.Body, types)
	}
	recordCalendarConcreteAssignments(fn.Body, types)
	return types
}

func recordCalendarConcreteAssignments(body *ast.BlockStmt, types map[*calendarObject]string) {
	ast.Inspect(body, func(node ast.Node) bool {
		assignment, ok := node.(*ast.AssignStmt)
		if !ok {
			return true
		}
		for i, lhs := range assignment.Lhs {
			id, ok := lhs.(*ast.Ident)
			if !ok || id.Obj == nil || i >= len(assignment.Rhs) {
				continue
			}
			if typeName := calendarExpressionType(assignment.Rhs[i], types); typeName != "" {
				types[id.Obj] = typeName
			}
		}
		return true
	})
}

func recordCalendarFieldTypes(fields *ast.FieldList, types map[*calendarObject]string) {
	if fields == nil {
		return
	}
	for _, field := range fields.List {
		for _, name := range field.Names {
			if name.Obj != nil {
				types[name.Obj] = expressionName(field.Type)
			}
		}
	}
}

func recordCalendarAssignedTypes(body *ast.BlockStmt, types map[*calendarObject]string) bool {
	changed := false
	ast.Inspect(body, func(node ast.Node) bool {
		switch declaration := node.(type) {
		case *ast.AssignStmt:
			for i, lhs := range declaration.Lhs {
				id, ok := lhs.(*ast.Ident)
				if ok && id.Obj != nil && i < len(declaration.Rhs) {
					changed = recordCalendarType(id.Obj, calendarExpressionType(declaration.Rhs[i], types), types) || changed
				}
			}
		case *ast.ValueSpec:
			for i, name := range declaration.Names {
				typeName := expressionName(declaration.Type)
				if typeName == "" && i < len(declaration.Values) {
					typeName = calendarExpressionType(declaration.Values[i], types)
				}
				changed = recordCalendarType(name.Obj, typeName, types) || changed
			}
		}
		return true
	})
	return changed
}

func recordCalendarType(object *calendarObject, typeName string, types map[*calendarObject]string) bool {
	if object == nil || typeName == "" || types[object] != "" {
		return false
	}
	types[object] = typeName
	return true
}

func calendarExpressionType(expr ast.Expr, types map[*calendarObject]string) string {
	switch value := expr.(type) {
	case *ast.CompositeLit:
		return expressionName(value.Type)
	case *ast.UnaryExpr:
		return calendarExpressionType(value.X, types)
	case *ast.ParenExpr:
		return calendarExpressionType(value.X, types)
	case *ast.Ident:
		if types != nil && types[value.Obj] != "" {
			return types[value.Obj]
		}
		return calendarObjectType(value.Obj, types, calendarVariables{})
	case *ast.CallExpr:
		if resultType := calendarFunctionResultType(value.Fun); resultType != "" {
			return resultType
		}
		return expressionName(value.Fun) + "()"
	default:
		return ""
	}
}

func calendarFunctionResultType(expr ast.Expr) string {
	id, ok := expr.(*ast.Ident)
	if !ok || id.Obj == nil {
		return ""
	}
	fn, ok := id.Obj.Decl.(*ast.FuncDecl)
	if !ok {
		return ""
	}
	return calendarResultType(fn)
}

func calendarResultType(fn *ast.FuncDecl) string {
	if fn.Type.Results == nil || len(fn.Type.Results.List) != 1 {
		return ""
	}
	return expressionName(fn.Type.Results.List[0].Type)
}

func calendarObjectType(object *calendarObject, types map[*calendarObject]string, seen calendarVariables) string {
	if object == nil || seen[object] {
		return ""
	}
	seen[object] = true
	switch declaration := object.Decl.(type) {
	case *ast.Field:
		return expressionName(declaration.Type)
	case *ast.ValueSpec:
		if typeName := expressionName(declaration.Type); typeName != "" {
			return typeName
		}
		for i, name := range declaration.Names {
			if name.Obj == object && i < len(declaration.Values) {
				return calendarExpressionType(declaration.Values[i], types)
			}
		}
	case *ast.AssignStmt:
		for i, lhs := range declaration.Lhs {
			id, ok := lhs.(*ast.Ident)
			if ok && id.Obj == object && i < len(declaration.Rhs) {
				return calendarExpressionType(declaration.Rhs[i], types)
			}
		}
	}
	return ""
}

func calendarCalledHelper(call *ast.CallExpr, receiverTypes map[*calendarObject]string) string {
	switch function := call.Fun.(type) {
	case *ast.Ident:
		return function.Name
	case *ast.SelectorExpr:
		if qualifier, ok := function.X.(*ast.Ident); ok && qualifier.Obj == nil {
			// An unresolved name is an import or a package-level value of
			// another file: pkg.Function resolves through the imports.
			return qualifier.Name + "." + function.Sel.Name
		}
		receiver := calendarExpressionType(function.X, receiverTypes)
		return calendarHelperIdentity(receiver, function.Sel.Name)
	default:
		return ""
	}
}

func isTestFunction(fn *ast.FuncDecl) bool {
	if fn.Recv != nil {
		return false
	}
	name := fn.Name.Name
	if strings.HasPrefix(name, "Example") {
		return fieldListArity(fn.Type.Params) == 0 && fieldListArity(fn.Type.Results) == 0
	}
	return (goTestName(name, "Test") || goTestName(name, "Benchmark") || goTestName(name, "Fuzz")) &&
		fieldListArity(fn.Type.Params) == 1 && fieldListArity(fn.Type.Results) == 0
}

func goTestName(name, prefix string) bool {
	if !strings.HasPrefix(name, prefix) || len(name) == len(prefix) {
		return false
	}
	first, _ := utf8.DecodeRuneInString(name[len(prefix):])
	return !unicode.IsLower(first)
}

func fieldListArity(fields *ast.FieldList) int {
	if fields == nil {
		return 0
	}
	count := 0
	for _, field := range fields.List {
		if len(field.Names) == 0 {
			count++
		} else {
			count += len(field.Names)
		}
	}
	return count
}

func newCalendarClockFinding(file, function string, line int, risk string) calendarClockFinding {
	return calendarClockFinding{file: file, function: function, line: line, risk: risk}
}

func formatCalendarClockFindings(findings []calendarClockFinding) []string {
	formatted := make([]string, 0, len(findings))
	for _, finding := range findings {
		formatted = append(formatted, fmt.Sprintf("%s:%d: %s: %s",
			finding.file, finding.line, finding.function, finding.risk))
	}
	return formatted
}
