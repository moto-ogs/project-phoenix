package test

import (
	"fmt"
	"go/ast"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
)

func discoverCalendarPackageHelpers(root string) (calendarPackageHelpers, error) {
	result := calendarPackageHelpers{
		dates: map[string]map[string]bool{}, instants: map[string]map[string]bool{}, scalars: map[string]map[string]bool{}, weekly: map[string]map[string]bool{}, weekdays: map[string]map[string]bool{},
		candidates: map[string]map[string][]calendarHelperCandidate{}, effectiveParams: map[string]map[string]map[int]bool{},
	}
	candidates := map[string][]calendarHelperCandidate{}
	fset := sharedGoFileSet
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if skipCalendarFixtureDir(entry) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, "_test.go") {
			return nil
		}
		return addCalendarHelperCandidates(path, fset, candidates, result)
	})
	if err != nil {
		return calendarPackageHelpers{}, err
	}
	indexCalendarHelperCandidates(candidates, result)
	propagateCalendarHelpers(candidates, result)
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

func addCalendarHelperCandidates(path string, fset *token.FileSet, candidates map[string][]calendarHelperCandidate, helpers calendarPackageHelpers) error {
	source, err := readGoSource(path)
	if err != nil {
		return fmt.Errorf("read %s while finding calendar helpers: %w", path, err)
	}
	_, file, err := parseGoSourceCached(path, source)
	if err != nil {
		return fmt.Errorf("parse %s while finding calendar helpers: %w", path, err)
	}
	key := calendarPackageKey(path, file.Name.Name)
	timePackages, timezonePackages := timeImportNames(file)
	for _, fn := range declaredFunctions(file) {
		if !isTestFunction(fn) {
			candidates[key] = append(candidates[key], calendarHelperCandidate{
				name: fn.Name.Name, receiver: calendarReceiverName(fn), resultType: calendarResultType(fn),
				fn:           fn,
				timePackages: timePackages, timezonePackages: timezonePackages,
			})
		}
	}
	helpers.dates[key] = map[string]bool{}
	helpers.instants[key] = map[string]bool{}
	helpers.scalars[key] = map[string]bool{}
	helpers.weekly[key] = map[string]bool{}
	helpers.weekdays[key] = map[string]bool{}
	return nil
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
		for key, packageCandidates := range candidates {
			syncCalendarMethodAliases(packageCandidates, helpers, key)
			for _, candidate := range packageCandidates {
				identity := calendarHelperIdentity(candidate.receiver, candidate.name)
				instantVars := currentCalendarInstantVariables(candidate.fn.Body, helpers.instants[key], candidate.timePackages, candidate.timezonePackages, nil)
				scalarVars := currentLiveInstantScalarVariables(candidate.fn.Body, instantVars, helpers.scalars[key], helpers.instants[key], candidate.timePackages, candidate.timezonePackages)
				dateVars := currentCalendarDateVariables(candidate.fn.Body, helpers.dates[key], candidate.timezonePackages)
				weeklyVars := currentCalendarInstantVariables(candidate.fn.Body, helpers.weekly[key], candidate.timePackages, candidate.timezonePackages, weeklyFixtureInstantField)
				weekdayVars := currentCalendarInstantVariables(candidate.fn.Body, helpers.weekdays[key], candidate.timePackages, candidate.timezonePackages, nil)
				if !helpers.dates[key][identity] && functionReturnsLiveDate(candidate.fn, dateVars, instantVars, helpers.dates[key], helpers.instants[key], candidate.timePackages, candidate.timezonePackages) {
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
