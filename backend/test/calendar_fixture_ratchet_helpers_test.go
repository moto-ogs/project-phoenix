package test

import (
	"fmt"
	"go/ast"
	"path/filepath"
	"strings"
)

func discoverCalendarPackageHelpers(root string) (calendarPackageHelpers, error) {
	result := calendarPackageHelpers{
		dates: map[string]map[string]bool{}, instants: map[string]map[string]bool{}, scalars: map[string]map[string]bool{}, weekly: map[string]map[string]bool{}, weekdays: map[string]map[string]bool{},
		candidates: map[string]map[string][]calendarHelperCandidate{}, effectiveParams: map[string]map[string]map[int]bool{},
		shifted: map[string]map[string]bool{}, shiftSinks: map[string]map[string]map[int]bool{}, shiftPassthrough: map[string]map[string]map[int]bool{},
		imports: map[string]map[string]string{},
	}
	discovery := calendarHelperDiscovery{
		root: root, helpers: result, candidates: map[string][]calendarHelperCandidate{},
		packageNames: map[string]string{}, imports: map[string][]calendarSupportImport{},
	}
	err := walkCalendarScannedFiles(root, discovery.addFile)
	if err != nil {
		return calendarPackageHelpers{}, err
	}
	candidates := discovery.candidates
	discovery.resolveImports()
	indexCalendarHelperCandidates(candidates, result)
	linkCalendarImportedCandidates(result)
	propagateCalendarHelpers(candidates, result)
	discoverCalendarShiftHelpers(candidates, result)
	return result, nil
}

func indexCalendarHelperCandidates(candidates map[string][]calendarHelperCandidate, helpers calendarPackageHelpers) {
	for key, packageCandidates := range candidates {
		helpers.candidates[key] = map[string][]calendarHelperCandidate{}
		for _, candidate := range packageCandidates {
			identity := calendarHelperIdentity(candidate.receiver, candidate.name)
			helpers.candidates[key][identity] = append(helpers.candidates[key][identity], candidate)
		}
		addCalendarMethodAliases(packageCandidates, helpers, key)
		helpers.effectiveParams[key] = discoverEffectiveBoundaryParameters(helpers.candidates[key])
	}
	for key, packageCandidates := range candidates {
		syncCalendarMethodAliases(packageCandidates, helpers, key)
	}
}

// addFile records the helper candidates, package name and test-support
// imports of one scanned file.
func (d *calendarHelperDiscovery) addFile(path string) error {
	source, err := readGoSource(path)
	if err != nil {
		return fmt.Errorf("read %s while finding calendar helpers: %w", path, err)
	}
	_, file, err := parseGoSourceCached(path, source)
	if err != nil {
		return fmt.Errorf("parse %s while finding calendar helpers: %w", path, err)
	}
	key := calendarPackageKey(path, file.Name.Name)
	if !strings.HasSuffix(path, "_test.go") {
		d.packageNames[filepath.Clean(filepath.Dir(path))] = file.Name.Name
	}
	d.recordImports(key, file)
	timePackages, timezonePackages := timeImportNames(file)
	valuePackages := calendarValuePackageNames(file)
	functions := append(declaredFunctions(file), calendarFunctionValueAliases(file)...)
	for _, fn := range functions {
		if !isTestFunction(fn) {
			d.candidates[key] = append(d.candidates[key], calendarHelperCandidate{
				name: fn.Name.Name, receiver: calendarReceiverName(fn), resultType: calendarResultType(fn),
				fn:           fn,
				timePackages: timePackages, timezonePackages: timezonePackages, valuePackages: valuePackages,
			})
		}
	}
	d.helpers.ensurePackage(key)
	return nil
}

// ensurePackage creates the empty helper registers of one package key
// without resetting registers another file of the package already filled.
func (h calendarPackageHelpers) ensurePackage(key string) {
	for _, flags := range h.flagRegisters() {
		if flags[key] == nil {
			flags[key] = map[string]bool{}
		}
	}
	for _, positions := range []map[string]map[string]map[int]bool{h.shiftSinks, h.shiftPassthrough} {
		if positions[key] == nil {
			positions[key] = map[string]map[int]bool{}
		}
	}
}

// flagRegisters lists every boolean helper register for cross-package sync.
func (h calendarPackageHelpers) flagRegisters() []map[string]map[string]bool {
	return []map[string]map[string]bool{h.dates, h.instants, h.scalars, h.weekly, h.weekdays, h.shifted}
}

func effectiveStructFieldIndexes(structure *ast.StructType) map[int]bool {
	indexes := map[int]bool{}
	position := 0
	for _, field := range structure.Fields.List {
		names := field.Names
		if len(names) == 0 {
			names = []*ast.Ident{{}}
		}
		for _, name := range names {
			if effectiveBoundaryName(name.Name) {
				indexes[position] = true
			}
			position++
		}
	}
	return indexes
}

func discoverEffectiveBoundaryParameters(candidates map[string][]calendarHelperCandidate) map[string]map[int]bool {
	sinks := map[string]map[int]bool{}
	for changed := true; changed; {
		changed = false
		for identity, matches := range candidates {
			for _, candidate := range matches {
				changed = markEffectiveBoundaryParameters(identity, candidate.fn, sinks) || changed
			}
		}
	}
	return sinks
}

func markEffectiveBoundaryParameters(identity string, fn *ast.FuncDecl, sinks map[string]map[int]bool) bool {
	parameters := calendarParameterPositions(fn.Type.Params)
	receiverTypes := calendarReceiverTypes(fn)
	changed := false
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		for _, expr := range effectiveBoundaryExpressions(node, sinks, receiverTypes) {
			for object, position := range parameters {
				if expressionUsesCalendarObject(expr, object) {
					changed = markEffectiveParameterSink(sinks, identity, position) || changed
				}
			}
		}
		return true
	})
	return changed
}

func calendarParameterPositions(fields *ast.FieldList) map[*calendarObject]int {
	positions := map[*calendarObject]int{}
	position := 0
	if fields == nil {
		return positions
	}
	for _, field := range fields.List {
		count := len(field.Names)
		if count == 0 {
			position++
			continue
		}
		for _, name := range field.Names {
			positions[name.Obj] = position
			position++
		}
	}
	return positions
}

func markEffectiveParameterSink(sinks map[string]map[int]bool, identity string, position int) bool {
	if sinks[identity] == nil {
		sinks[identity] = map[int]bool{}
	}
	if sinks[identity][position] {
		return false
	}
	sinks[identity][position] = true
	return true
}

func expressionUsesCalendarObject(expr ast.Expr, object *calendarObject) bool {
	used := false
	ast.Inspect(expr, func(node ast.Node) bool {
		identifier, ok := node.(*ast.Ident)
		if ok && identifier.Obj == object {
			used = true
		}
		return !used
	})
	return used
}

func addCalendarMethodAliases(candidates []calendarHelperCandidate, helpers calendarPackageHelpers, key string) {
	for _, method := range candidates {
		if method.receiver == "" {
			continue
		}
		for _, factory := range candidates {
			if factory.receiver != "" || factory.resultType != method.receiver {
				continue
			}
			alias := calendarHelperIdentity(factory.name+"()", method.name)
			helpers.candidates[key][alias] = append(helpers.candidates[key][alias], method)
		}
	}
}

func syncCalendarMethodAliases(candidates []calendarHelperCandidate, helpers calendarPackageHelpers, key string) {
	for _, method := range candidates {
		identity := calendarHelperIdentity(method.receiver, method.name)
		for _, factory := range candidates {
			if method.receiver == "" || factory.receiver != "" || factory.resultType != method.receiver {
				continue
			}
			alias := calendarHelperIdentity(factory.name+"()", method.name)
			helpers.dates[key][alias] = helpers.dates[key][identity]
			helpers.instants[key][alias] = helpers.instants[key][identity]
			helpers.scalars[key][alias] = helpers.scalars[key][identity]
			helpers.weekly[key][alias] = helpers.weekly[key][identity]
			helpers.weekdays[key][alias] = helpers.weekdays[key][identity]
		}
	}
}

func calendarPackageKey(path, packageName string) string {
	return filepath.Clean(filepath.Dir(path)) + ":" + packageName
}

func propagateCalendarHelpers(candidates map[string][]calendarHelperCandidate, helpers calendarPackageHelpers) {
	for changed := true; changed; {
		changed = false
		syncCalendarImportedHelpers(helpers)
		for key, packageCandidates := range candidates {
			syncCalendarMethodAliases(packageCandidates, helpers, key)
			for _, candidate := range packageCandidates {
				identity := calendarHelperIdentity(candidate.receiver, candidate.name)
				instantVars := currentCalendarInstantVariables(candidate.fn.Body, helpers.instants[key], candidate.timePackages, candidate.timezonePackages, nil)
				scalarVars := currentLiveInstantScalarVariables(candidate.fn.Body, instantVars, helpers.scalars[key], helpers.instants[key], candidate.timePackages, candidate.timezonePackages)
				dateVars := currentCalendarDateVariables(candidate.fn.Body, helpers.dates[key], candidate.timezonePackages)
				weeklyVars := currentCalendarInstantVariables(candidate.fn.Body, helpers.weekly[key], candidate.timePackages, candidate.timezonePackages, weeklyFixtureInstantField)
				weekdayVars := currentCalendarInstantVariables(candidate.fn.Body, helpers.weekdays[key], candidate.timePackages, candidate.timezonePackages, nil)
				if !helpers.dates[key][identity] && !calendarIdentifierResult(candidate.resultType) && functionReturnsLiveDate(candidate.fn, dateVars, instantVars, helpers.dates[key], helpers.instants[key], candidate.timePackages, candidate.timezonePackages) {
					helpers.dates[key][identity], changed = true, true
				}
				if !helpers.instants[key][identity] && functionReturnsLiveInstant(candidate.fn, instantVars, helpers.instants[key], candidate.timePackages, candidate.timezonePackages) {
					helpers.instants[key][identity], changed = true, true
				}
				if !helpers.scalars[key][identity] && functionReturnsLiveScalar(candidate.fn, scalarVars, instantVars, helpers.scalars[key], helpers.instants[key], candidate.timePackages, candidate.timezonePackages) {
					helpers.scalars[key][identity], changed = true, true
				}
				if !helpers.weekly[key][identity] && functionReturnsLiveWeeklyInstant(candidate.fn, weeklyVars, helpers.weekly[key], candidate.timePackages, candidate.timezonePackages) {
					helpers.weekly[key][identity], changed = true, true
				}
				if !helpers.weekdays[key][identity] && functionReturnsLiveWeekday(candidate.fn, weekdayVars, helpers.weekdays[key], helpers.dates[key], candidate.timePackages, candidate.timezonePackages) {
					helpers.weekdays[key][identity], changed = true, true
				}
			}
		}
	}
}

func functionReturnsLiveWeekday(fn *ast.FuncDecl, instantVars calendarVariables, instantHelpers, dateHelpers, timePackages, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		expr, ok := node.(ast.Expr)
		if ok && expressionUsesLiveWeekday(expr, instantVars, instantHelpers, dateHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func functionReturnsLiveDate(fn *ast.FuncDecl, dateVars, instantVars calendarVariables, dateHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	return functionReturns(fn, func(expr ast.Expr) bool {
		return expressionContainsTodayDate(expr, dateVars, dateHelpers, timezonePackages) ||
			expressionUsesLiveDateConversion(expr, instantVars, instantHelpers, timePackages, timezonePackages)
	})
}

func expressionUsesLiveDateConversion(expr ast.Expr, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if ok && isImportedCall(call.Fun, timezonePackages, "DateFromTime") && len(call.Args) > 0 &&
			expressionUsesCalendarInstant(call.Args[0], instantVars, instantHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func functionReturnsLiveInstant(fn *ast.FuncDecl, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	return functionReturns(fn, func(expr ast.Expr) bool {
		return expressionUsesCalendarInstant(expr, instantVars, instantHelpers, timePackages, timezonePackages)
	})
}

func functionReturnsLiveScalar(fn *ast.FuncDecl, scalarVars, instantVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	return functionReturns(fn, func(expr ast.Expr) bool {
		return expressionUsesLiveInstantScalar(expr, scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages)
	})
}

func functionReturnsLiveWeeklyInstant(fn *ast.FuncDecl, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	return functionReturns(fn, func(expr ast.Expr) bool {
		return expressionUsesWeeklyFixtureInstant(expr, instantVars, instantHelpers, timePackages, timezonePackages)
	})
}

func functionReturns(fn *ast.FuncDecl, predicate func(ast.Expr) bool) bool {
	found := false
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		if _, nested := node.(*ast.FuncLit); nested {
			return false
		}
		returned, ok := node.(*ast.ReturnStmt)
		for _, expression := range returnedResults(returned, ok) {
			found = found || predicate(expression)
		}
		return !found
	})
	return found
}

func returnedResults(statement *ast.ReturnStmt, ok bool) []ast.Expr {
	if !ok {
		return nil
	}
	return statement.Results
}

// calendarIdentifierResult is a helper that returns a row ID or a flag: a
// fixture inserted on a live day still returns no date.
func calendarIdentifierResult(resultType string) bool {
	switch resultType {
	case "bool", "error", "int", "int32", "int64", "uint", "uint64":
		return true
	default:
		return false
	}
}
