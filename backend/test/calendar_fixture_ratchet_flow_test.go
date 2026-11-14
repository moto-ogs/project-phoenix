package test

import (
	"go/ast"
	"go/token"
	"sort"
	"strings"
)

func currentCalendarInstantVariables(body *ast.BlockStmt, instantHelpers, timePackages, timezonePackages map[string]bool, fieldFilter func(ast.Expr) bool) calendarVariables {
	instantVars := calendarVariables{}
	for changed := true; changed; {
		changed = false
		ast.Inspect(body, func(node ast.Node) bool {
			switch declaration := node.(type) {
			case *ast.AssignStmt:
				for i, lhs := range declaration.Lhs {
					if i >= len(declaration.Rhs) {
						continue
					}
					id, isID := lhs.(*ast.Ident)
					if isID && markCurrentInstant(id.Obj, declaration.Rhs[i], instantVars, instantHelpers, timePackages, timezonePackages, fieldFilter) {
						changed = true
					}
					selector, selected := lhs.(*ast.SelectorExpr)
					root, rooted := selectorRootObject(selector, selected)
					if rooted && (fieldFilter == nil || fieldFilter(selector.Sel)) && markCurrentInstant(root, declaration.Rhs[i], instantVars, instantHelpers, timePackages, timezonePackages, fieldFilter) {
						changed = true
					}
				}
			case *ast.ValueSpec:
				for i, name := range declaration.Names {
					if i < len(declaration.Values) && markCurrentInstant(name.Obj, declaration.Values[i], instantVars, instantHelpers, timePackages, timezonePackages, fieldFilter) {
						changed = true
					}
				}
			}
			return true
		})
	}
	return instantVars
}

func markCurrentInstant(object *calendarObject, value ast.Expr, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool, fieldFilter func(ast.Expr) bool) bool {
	usesInstant := expressionUsesCalendarInstant(value, instantVars, instantHelpers, timePackages, timezonePackages)
	if fieldFilter != nil {
		usesInstant = expressionUsesWeeklyFixtureInstant(value, instantVars, instantHelpers, timePackages, timezonePackages)
	}
	if object == nil || instantVars[object] || !usesInstant {
		return false
	}
	instantVars[object] = true
	return true
}

func expressionUsesCalendarInstant(expr ast.Expr, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		id, named := node.(*ast.Ident)
		if named && id.Obj != nil && instantVars[id.Obj] {
			found = true
			return false
		}
		call, called := node.(*ast.CallExpr)
		if called && liveInstantReconstruction(call, instantVars, instantHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		if called && calendarInstantScalarConversion(call) {
			return false
		}
		if called && isLiveInstantSource(call, instantHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func liveInstantReconstruction(call *ast.CallExpr, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	return liveInstantReconstructionWithScalars(call, calendarVariables{}, instantVars, map[string]bool{}, instantHelpers, timePackages, timezonePackages)
}

func liveInstantReconstructionWithScalars(call *ast.CallExpr, scalarVars, instantVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	if !isImportedCall(call.Fun, timePackages, "Unix") &&
		!isImportedCall(call.Fun, timePackages, "UnixMilli") &&
		!isImportedCall(call.Fun, timePackages, "UnixMicro") {
		return false
	}
	for _, argument := range call.Args {
		if expressionUsesLiveInstantScalar(argument, scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
			return true
		}
	}
	return false
}

func expressionContainsLiveInstantReconstruction(expr ast.Expr, scalarVars, instantVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if ok && liveInstantReconstructionWithScalars(call, scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func calendarInstantScalarConversion(call *ast.CallExpr) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || len(call.Args) != 0 {
		return false
	}
	switch selector.Sel.Name {
	case "Unix", "UnixMilli", "UnixMicro", "UnixNano":
		return true
	default:
		return false
	}
}

func expressionUsesWeeklyFixtureInstant(expr ast.Expr, instantVars calendarVariables, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		if field, ok := node.(*ast.KeyValueExpr); ok && !weeklyFixtureInstantField(field.Key) {
			return false
		}
		if call, ok := node.(*ast.CallExpr); ok && liveInstantReconstruction(call, instantVars, instantHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		if call, ok := node.(*ast.CallExpr); ok && calendarInstantScalarConversion(call) {
			return false
		}
		id, named := node.(*ast.Ident)
		if named && id.Obj != nil && instantVars[id.Obj] {
			found = true
		}
		call, called := node.(*ast.CallExpr)
		if called && isLiveInstantSource(call, instantHelpers, timePackages, timezonePackages) {
			found = true
		}
		return !found
	})
	return found
}

func currentCalendarDateVariables(body *ast.BlockStmt, dateHelpers, timezonePackages map[string]bool) calendarVariables {
	dateVars := calendarVariables{}
	for changed := true; changed; {
		changed = false
		ast.Inspect(body, func(node ast.Node) bool {
			switch declaration := node.(type) {
			case *ast.AssignStmt:
				for i, lhs := range declaration.Lhs {
					if i >= len(declaration.Rhs) {
						continue
					}
					id, isID := lhs.(*ast.Ident)
					if isID && markCurrentDate(id.Obj, declaration.Rhs[i], dateVars, dateHelpers, timezonePackages) {
						changed = true
					}
					selector, selected := lhs.(*ast.SelectorExpr)
					root, rooted := selectorRootObject(selector, selected)
					if rooted && markCurrentDate(root, declaration.Rhs[i], dateVars, dateHelpers, timezonePackages) {
						changed = true
					}
				}
			case *ast.ValueSpec:
				for i, name := range declaration.Names {
					if i < len(declaration.Values) && markCurrentDate(name.Obj, declaration.Values[i], dateVars, dateHelpers, timezonePackages) {
						changed = true
					}
				}
			}
			return true
		})
	}
	return dateVars
}

func markCurrentDate(object *calendarObject, value ast.Expr, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) bool {
	if object == nil || dateVars[object] || !expressionUsesTodayDate(value, dateVars, dateHelpers, timezonePackages) {
		return false
	}
	dateVars[object] = true
	return true
}

func expressionUsesTodayDate(expr ast.Expr, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) bool {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Obj != nil && dateVars[value.Obj]
	case *ast.ParenExpr:
		return expressionUsesTodayDate(value.X, dateVars, dateHelpers, timezonePackages)
	case *ast.CallExpr:
		if dateHelpers[calendarCalledHelper(value, nil)] {
			return true
		}
		if isImportedCall(value.Fun, timezonePackages, "TodayDate") {
			return true
		}
		if selector, ok := value.Fun.(*ast.SelectorExpr); ok {
			if expressionUsesTodayDate(selector.X, dateVars, dateHelpers, timezonePackages) {
				return true
			}
		}
		if strings.Contains(calendarFunctionResultType(value.Fun), "Date") {
			for _, argument := range value.Args {
				if expressionUsesTodayDate(argument, dateVars, dateHelpers, timezonePackages) {
					return true
				}
			}
		}
		return false
	case *ast.CompositeLit:
		for _, element := range value.Elts {
			field, keyed := element.(*ast.KeyValueExpr)
			if keyed && calendarRangeFieldName(expressionName(field.Key)) &&
				expressionUsesTodayDate(field.Value, dateVars, dateHelpers, timezonePackages) {
				return true
			}
		}
		return false
	case *ast.KeyValueExpr:
		return expressionUsesTodayDate(value.Key, dateVars, dateHelpers, timezonePackages) ||
			expressionUsesTodayDate(value.Value, dateVars, dateHelpers, timezonePackages)
	case *ast.SelectorExpr:
		return expressionUsesTodayDate(value.X, dateVars, dateHelpers, timezonePackages)
	case *ast.BinaryExpr:
		return expressionUsesTodayDate(value.X, dateVars, dateHelpers, timezonePackages) ||
			expressionUsesTodayDate(value.Y, dateVars, dateHelpers, timezonePackages)
	case *ast.UnaryExpr:
		return expressionUsesTodayDate(value.X, dateVars, dateHelpers, timezonePackages)
	case *ast.StarExpr:
		return expressionUsesTodayDate(value.X, dateVars, dateHelpers, timezonePackages)
	case *ast.IndexExpr:
		return expressionUsesTodayDate(value.X, dateVars, dateHelpers, timezonePackages) ||
			expressionUsesTodayDate(value.Index, dateVars, dateHelpers, timezonePackages)
	default:
		return false
	}
}

func expressionContainsTodayDate(expr ast.Expr, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		expression, ok := node.(ast.Expr)
		if ok && expressionUsesTodayDate(expression, dateVars, dateHelpers, timezonePackages) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func findLiveDateShifts(fn *ast.FuncDecl, rel string, fset *token.FileSet, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if ok && selector.Sel.Name == "AddDays" && expressionUsesTodayDate(selector.X, dateVars, dateHelpers, timezonePackages) {
			findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(call.Pos()).Line, "live calendar date shifted into a range"))
		}
		return true
	})
	return findings
}

func findLiveScalarDateShifts(fn *ast.FuncDecl, rel string, fset *token.FileSet, instantVars, scalarVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "AddDays" {
			return true
		}
		for _, argument := range call.Args {
			if expressionUsesLiveInstantScalar(argument, scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
				findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(call.Pos()).Line, "live scalar clock value shifts a calendar date"))
				break
			}
		}
		return true
	})
	return findings
}

func expressionUsesLiveInstantScalar(expr ast.Expr, scalarVars, instantVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		id, named := node.(*ast.Ident)
		if named && id.Obj != nil && scalarVars[id.Obj] {
			found = true
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if ok && scalarHelpers[calendarCalledHelper(call, nil)] {
			found = true
			return false
		}
		if !ok || !calendarInstantScalarConversion(call) {
			return !found
		}
		selector := call.Fun.(*ast.SelectorExpr)
		if expressionUsesCalendarInstant(selector.X, instantVars, instantHelpers, timePackages, timezonePackages) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func currentLiveInstantScalarVariables(body *ast.BlockStmt, instantVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) calendarVariables {
	scalarVars := calendarVariables{}
	for changed := true; changed; {
		changed = false
		ast.Inspect(body, func(node ast.Node) bool {
			switch declaration := node.(type) {
			case *ast.AssignStmt:
				for i, lhs := range declaration.Lhs {
					id, ok := lhs.(*ast.Ident)
					if !ok || id.Obj == nil || scalarVars[id.Obj] || i >= len(declaration.Rhs) {
						continue
					}
					if expressionUsesLiveInstantScalar(declaration.Rhs[i], scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
						scalarVars[id.Obj] = true
						changed = true
					}
				}
			case *ast.ValueSpec:
				for i, name := range declaration.Names {
					if name.Obj == nil || scalarVars[name.Obj] || i >= len(declaration.Values) {
						continue
					}
					if expressionUsesLiveInstantScalar(declaration.Values[i], scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
						scalarVars[name.Obj] = true
						changed = true
					}
				}
			}
			return true
		})
	}
	return scalarVars
}

var weeklySummarySelectors = map[string]bool{
	"WeeklySummary":   true,
	"WeeklySummaries": true,
}

func hasWeeklySummaryExpectation(body *ast.BlockStmt) bool {
	found := false
	ast.Inspect(body, func(node ast.Node) bool {
		selector, ok := node.(*ast.SelectorExpr)
		if ok && weeklySummarySelectors[selector.Sel.Name] {
			found = true
			return false
		}
		return !found
	})
	return found
}

func findDirectCalendarBoundaryCalls(fn *ast.FuncDecl, rel string, fset *token.FileSet, instantVars, dateVars calendarVariables, instantHelpers, dateHelpers, timePackages, timezonePackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (selector.Sel.Name != "ISOWeek" && selector.Sel.Name != "Weekday") {
			return true
		}
		usesInstant := expressionUsesCalendarInstant(selector.X, instantVars, instantHelpers, timePackages, timezonePackages)
		usesDate := expressionUsesTodayDate(selector.X, dateVars, dateHelpers, timezonePackages)
		if usesInstant || usesDate {
			findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(call.Pos()).Line, "live clock feeds a day or ISO-week expectation"))
		}
		return true
	})
	return findings
}

func findLiveWeekdayHelperCalls(fn *ast.FuncDecl, rel string, fset *token.FileSet, weekdayHelpers, timePackages, timezonePackages map[string]bool) []calendarClockFinding {
	if len(weekdayHelpers) == 0 {
		return nil
	}
	receiverTypes := calendarReceiverTypes(fn)
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || !weekdayHelpers[calendarCalledHelper(call, receiverTypes)] {
			return true
		}
		findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(call.Pos()).Line, "live clock feeds a weekday fixture"))
		return true
	})
	return findings
}

func expressionUsesLiveWeekday(expr ast.Expr, instantVars calendarVariables, instantHelpers, dateHelpers, timePackages, timezonePackages map[string]bool) bool {
	if call, ok := expr.(*ast.CallExpr); ok && instantHelpers[calendarCalledHelper(call, nil)] {
		return true
	}
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return false
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	return ok && (selector.Sel.Name == "Weekday" || selector.Sel.Name == "ISOWeek") &&
		(expressionUsesCalendarInstant(selector.X, instantVars, instantHelpers, timePackages, timezonePackages) ||
			expressionUsesTodayDate(selector.X, calendarVariables{}, dateHelpers, timezonePackages))
}

func findLiveWeeklyFixtureInstants(fn *ast.FuncDecl, rel string, fset *token.FileSet, scalarVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) []calendarClockFinding {
	assignments := assignedCalendarExpressions(fn.Body)
	sources := map[token.Pos]ast.Expr{}
	receiverTypes := calendarReceiverTypes(fn)
	for _, root := range weeklySummaryRoots(fn.Body) {
		collectLiveInstantSources(root, assignments, scalarVars, scalarHelpers, instantHelpers, timePackages, timezonePackages, receiverTypes, calendarVariables{}, sources)
	}
	positions := make([]token.Pos, 0, len(sources))
	for position := range sources {
		positions = append(positions, position)
	}
	sort.Slice(positions, func(i, j int) bool { return positions[i] < positions[j] })
	var findings []calendarClockFinding
	for _, position := range positions {
		findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(position).Line, "live instant feeds an ISO-week expectation"))
	}
	return findings
}

func assignedCalendarExpressions(body *ast.BlockStmt) map[*calendarObject][]ast.Expr {
	assignments := map[*calendarObject][]ast.Expr{}
	ast.Inspect(body, func(node ast.Node) bool {
		switch declaration := node.(type) {
		case *ast.AssignStmt:
			for i, lhs := range declaration.Lhs {
				id, isID := lhs.(*ast.Ident)
				if isID && id.Obj != nil && i < len(declaration.Rhs) {
					assignments[id.Obj] = append(assignments[id.Obj], declaration.Rhs[i])
				}
				selector, selected := lhs.(*ast.SelectorExpr)
				root, rooted := selectorRootObject(selector, selected)
				if rooted && weeklyFixtureInstantField(selector.Sel) && i < len(declaration.Rhs) {
					assignments[root] = append(assignments[root], declaration.Rhs[i])
				}
			}
		case *ast.ValueSpec:
			for i, name := range declaration.Names {
				if name.Obj != nil && i < len(declaration.Values) {
					assignments[name.Obj] = append(assignments[name.Obj], declaration.Values[i])
				}
			}
		}
		return true
	})
	return assignments
}

func weeklySummaryRoots(body *ast.BlockStmt) []ast.Expr {
	var roots []ast.Expr
	ast.Inspect(body, func(node ast.Node) bool {
		selector, ok := node.(*ast.SelectorExpr)
		if ok && weeklySummarySelectors[selector.Sel.Name] {
			roots = append(roots, selector.X)
		}
		return true
	})
	return roots
}

func collectLiveInstantSources(expr ast.Expr, assignments map[*calendarObject][]ast.Expr, scalarVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool, receiverTypes map[*calendarObject]string, seen calendarVariables, sources map[token.Pos]ast.Expr) {
	ast.Inspect(expr, func(node ast.Node) bool {
		if field, ok := node.(*ast.KeyValueExpr); ok && !weeklyFixtureInstantField(field.Key) {
			return false
		}
		call, called := node.(*ast.CallExpr)
		if called && liveInstantReconstructionWithScalars(call, scalarVars, calendarVariables{}, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
			sources[call.Pos()] = call
			return false
		}
		if called && calendarInstantScalarConversion(call) {
			return false
		}
		if called && isLiveInstantSourceWithReceiverTypes(call, instantHelpers, timePackages, timezonePackages, receiverTypes) {
			sources[call.Pos()] = call
			return false
		}
		id, named := node.(*ast.Ident)
		if !named || id.Obj == nil || seen[id.Obj] {
			return true
		}
		values := assignments[id.Obj]
		if len(values) == 0 {
			return true
		}
		seen[id.Obj] = true
		for _, value := range values {
			collectLiveInstantSources(value, assignments, scalarVars, scalarHelpers, instantHelpers, timePackages, timezonePackages, receiverTypes, seen, sources)
		}
		return false
	})
}

func weeklyFixtureInstantField(expr ast.Expr) bool {
	field, ok := expr.(*ast.Ident)
	return ok && (field.Name == "CheckInTime" || field.Name == "CheckOutTime")
}

func isLiveInstantSource(call *ast.CallExpr, instantHelpers, timePackages, timezonePackages map[string]bool) bool {
	return isLiveInstantSourceWithReceiverTypes(call, instantHelpers, timePackages, timezonePackages, nil)
}

func isLiveInstantSourceWithReceiverTypes(call *ast.CallExpr, instantHelpers, timePackages, timezonePackages map[string]bool, types map[*calendarObject]string) bool {
	if isImportedCall(call.Fun, timePackages, "Now") || isImportedCall(call.Fun, timezonePackages, "Now") {
		return true
	}
	return instantHelpers[calendarCalledHelper(call, types)]
}
