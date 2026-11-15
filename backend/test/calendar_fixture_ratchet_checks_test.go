package test

import (
	"go/ast"
	"go/token"
	pathpkg "path"
	"strconv"
	"strings"
)

func (scan calendarFunctionScan) findings() []calendarClockFinding {
	findings := findInstantDateConversions(scan.fn, scan.file, scan.fset, scan.instantVars, scan.scalarVars, scan.scalarHelpers, scan.instantHelpers, scan.timePackages, scan.timezonePackages)
	findings = append(findings, findDirectCalendarBoundaryCalls(scan.fn, scan.file, scan.fset, scan.instantVars, scan.dateVars, scan.instantHelpers, scan.dateHelpers, scan.timePackages, scan.timezonePackages)...)
	findings = append(findings, findLiveWeekdayHelperCalls(scan.fn, scan.file, scan.fset, scan.weekdayHelpers, scan.timePackages, scan.timezonePackages)...)
	findings = append(findings, findLiveCalendarRangeCalls(scan.fn, scan.file, scan.fset, scan.dateVars, scan.rangeVars, scan.dateHelpers, scan.timezonePackages)...)
	findings = append(findings, findLiveCalendarAssertions(scan.fn, scan.file, scan.fset, scan.dateVars, scan.dateHelpers, scan.timezonePackages, scan.assertionPackages)...)
	findings = append(findings, findLiveCalendarComparisons(scan.fn, scan.file, scan.fset, scan.dateVars, scan.dateHelpers, scan.timezonePackages)...)
	findings = append(findings, findLiveScalarDateShifts(scan.fn, scan.file, scan.fset, scan.instantVars, scan.scalarVars, scan.scalarHelpers, scan.instantHelpers, scan.timePackages, scan.timezonePackages)...)
	if hasWeeklySummaryExpectation(scan.fn.Body) {
		findings = append(findings, findLiveDateShifts(scan.fn, scan.file, scan.fset, scan.dateVars, scan.dateHelpers, scan.timezonePackages)...)
		findings = append(findings, findLiveWeeklyFixtureInstants(scan.fn, scan.file, scan.fset, scan.scalarVars, scan.scalarHelpers, scan.weeklyHelpers, scan.timePackages, scan.timezonePackages)...)
	}
	return findings
}

func findLiveCalendarRangeCalls(fn *ast.FuncDecl, rel string, fset *token.FileSet, dateVars, rangeVars calendarVariables, dateHelpers, timezonePackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		name := expressionName(call.Fun)
		liveDateArgs := 0
		liveRangeArg := false
		for _, arg := range call.Args {
			if calendarRangeArgumentUsesLiveDate(arg, dateVars, dateHelpers, timezonePackages) {
				liveDateArgs++
			}
			liveRangeArg = liveRangeArg || expressionUsesCalendarRange(arg, rangeVars) ||
				liveCalendarRangeLiteral(arg, dateVars, dateHelpers, timezonePackages)
		}
		if (calendarRangeCallName(name) && liveDateArgs >= 1) ||
			(calendarRangeConsumerName(name) && (liveRangeArg || liveDateArgs >= 2)) {
			findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(call.Pos()).Line, "live clock defines a calendar range"))
		}
		return true
	})
	return findings
}

func currentLiveCalendarRangeVariables(body *ast.BlockStmt, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) calendarVariables {
	rangeVars := calendarVariables{}
	for changed := true; changed; {
		changed = false
		ast.Inspect(body, func(node ast.Node) bool {
			switch declaration := node.(type) {
			case *ast.AssignStmt:
				for i, lhs := range declaration.Lhs {
					if i >= len(declaration.Rhs) {
						continue
					}
					if id, ok := lhs.(*ast.Ident); ok && id.Obj != nil && !rangeVars[id.Obj] &&
						(liveCalendarRangeLiteral(declaration.Rhs[i], dateVars, dateHelpers, timezonePackages) || expressionUsesCalendarRange(declaration.Rhs[i], rangeVars)) {
						rangeVars[id.Obj], changed = true, true
					}
					selector, selected := lhs.(*ast.SelectorExpr)
					root, named := selectorRootObject(selector, selected)
					if named && !rangeVars[root] && calendarRangeFieldName(selector.Sel.Name) && expressionContainsTodayDate(declaration.Rhs[i], dateVars, dateHelpers, timezonePackages) {
						rangeVars[root], changed = true, true
					}
				}
			case *ast.ValueSpec:
				for i, name := range declaration.Names {
					if i < len(declaration.Values) && name.Obj != nil && !rangeVars[name.Obj] &&
						(liveCalendarRangeLiteral(declaration.Values[i], dateVars, dateHelpers, timezonePackages) || expressionUsesCalendarRange(declaration.Values[i], rangeVars)) {
						rangeVars[name.Obj], changed = true, true
					}
				}
			}
			return true
		})
	}
	return rangeVars
}

func selectorRootObject(selector *ast.SelectorExpr, ok bool) (*calendarObject, bool) {
	if !ok {
		return nil, false
	}
	root, named := selector.X.(*ast.Ident)
	if !named {
		return nil, false
	}
	return root.Obj, root.Obj != nil
}

func liveCalendarRangeLiteral(expr ast.Expr, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) bool {
	if pointer, ok := expr.(*ast.UnaryExpr); ok && pointer.Op == token.AND {
		return liveCalendarRangeLiteral(pointer.X, dateVars, dateHelpers, timezonePackages)
	}
	if paren, ok := expr.(*ast.ParenExpr); ok {
		return liveCalendarRangeLiteral(paren.X, dateVars, dateHelpers, timezonePackages)
	}
	literal, ok := expr.(*ast.CompositeLit)
	return ok && (calendarRangeTypeName(expressionName(literal.Type)) || calendarRangeLiteralHasBoundaryField(literal)) &&
		expressionContainsTodayDate(literal, dateVars, dateHelpers, timezonePackages)
}

func calendarRangeLiteralHasBoundaryField(literal *ast.CompositeLit) bool {
	for _, element := range literal.Elts {
		field, ok := element.(*ast.KeyValueExpr)
		if ok && calendarRangeFieldName(expressionName(field.Key)) {
			return true
		}
	}
	return false
}

func expressionUsesCalendarRange(expr ast.Expr, rangeVars calendarVariables) bool {
	usesRange := false
	ast.Inspect(expr, func(node ast.Node) bool {
		id, ok := node.(*ast.Ident)
		usesRange = usesRange || (ok && id.Obj != nil && rangeVars[id.Obj])
		return !usesRange
	})
	return usesRange
}

func calendarRangeArgumentUsesLiveDate(expr ast.Expr, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) bool {
	return expressionContainsTodayDate(expr, dateVars, dateHelpers, timezonePackages)
}

func findLiveCalendarAssertions(fn *ast.FuncDecl, rel string, fset *token.FileSet, dateVars calendarVariables, dateHelpers, timezonePackages, assertionPackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || !isAssertionCall(call.Fun, assertionPackages) {
			return true
		}
		for _, arg := range call.Args[1:] {
			if expressionContainsTodayDate(arg, dateVars, dateHelpers, timezonePackages) {
				findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(arg.Pos()).Line, "live calendar date used as an expectation"))
				break
			}
		}
		return true
	})
	return findings
}

func isAssertionCall(expr ast.Expr, assertionPackages map[string]bool) bool {
	if identifier, ok := expr.(*ast.Ident); ok {
		return identifier.Obj == nil && calendarAssertionMethods[identifier.Name] && assertionPackages["."]
	}
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok || !calendarAssertionMethods[selector.Sel.Name] {
		return false
	}
	pkg, ok := selector.X.(*ast.Ident)
	return ok && pkg.Obj == nil && assertionPackages[pkg.Name]
}

var calendarAssertionMethods = map[string]bool{
	"Contains":       true,
	"ElementsMatch":  true,
	"Equal":          true,
	"EqualValues":    true,
	"Exactly":        true,
	"False":          true,
	"Greater":        true,
	"GreaterOrEqual": true,
	"Less":           true,
	"LessOrEqual":    true,
	"NotContains":    true,
	"NotEqual":       true,
	"True":           true,
}

func findLiveCalendarComparisons(fn *ast.FuncDecl, rel string, fset *token.FileSet, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		comparison, ok := node.(*ast.BinaryExpr)
		if !ok || !isComparisonOperator(comparison.Op) {
			return true
		}
		if expressionContainsTodayDate(comparison, dateVars, dateHelpers, timezonePackages) {
			findings = append(findings, newCalendarClockFinding(rel, fn.Name.Name, fset.Position(comparison.Pos()).Line, "live calendar date used in a comparison"))
		}
		return true
	})
	return findings
}

func isComparisonOperator(operator token.Token) bool {
	return operator == token.EQL || operator == token.NEQ || operator == token.LSS ||
		operator == token.LEQ || operator == token.GTR || operator == token.GEQ
}

func assertionImportNames(file *ast.File) map[string]bool {
	packages := map[string]bool{}
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil || (!strings.HasSuffix(importPath, "/assert") && !strings.HasSuffix(importPath, "/require")) {
			continue
		}
		name := pathpkg.Base(importPath)
		if spec.Name != nil {
			if spec.Name.Name == "." {
				name = "."
			} else if spec.Name.Name != "_" {
				name = spec.Name.Name
			}
		}
		packages[name] = true
	}
	return packages
}

func calendarRangeCallName(name string) bool {
	return strings.Contains(name, "History") || strings.Contains(name, "Range") ||
		strings.Contains(name, "Period") || strings.Contains(name, "Between")
}

func calendarRangeConsumerName(name string) bool {
	return strings.Contains(name, "List") || strings.Contains(name, "Find") || strings.Contains(name, "Get") ||
		strings.Contains(name, "Count") || strings.Contains(name, "Query") || strings.Contains(name, "Search") ||
		calendarRangeCallName(name)
}

func calendarRangeTypeName(name string) bool {
	return strings.Contains(name, "Range") || strings.Contains(name, "Period") || strings.Contains(name, "Window")
}

func calendarRangeFieldName(name string) bool {
	switch name {
	case "From", "To", "Start", "End", "DateFrom", "DateTo", "StartDate", "EndDate":
		return true
	default:
		return false
	}
}

func findLiveEffectiveBoundaries(fn *ast.FuncDecl, rel string, fset *token.FileSet, dateVars calendarVariables, dateHelpers, timezonePackages map[string]bool, parameterSinks map[string]map[int]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	receiverTypes := calendarReceiverTypes(fn)
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		for _, expr := range effectiveBoundaryExpressions(node, parameterSinks, receiverTypes) {
			if !expressionContainsTodayDate(expr, dateVars, dateHelpers, timezonePackages) {
				continue
			}
			findings = append(findings, newCalendarClockFinding(
				rel, fn.Name.Name, fset.Position(expr.Pos()).Line,
				"live calendar date used as an effective boundary",
			))
		}
		return true
	})
	return findings
}

func effectiveBoundaryExpressions(node ast.Node, parameterSinks map[string]map[int]bool, receiverTypes map[*calendarObject]string) []ast.Expr {
	switch value := node.(type) {
	case *ast.AssignStmt:
		var expressions []ast.Expr
		for i, lhs := range value.Lhs {
			if i < len(value.Rhs) && effectiveBoundaryName(expressionName(lhs)) {
				expressions = append(expressions, value.Rhs[i])
			}
		}
		return expressions
	case *ast.ValueSpec:
		var expressions []ast.Expr
		for i, name := range value.Names {
			if i < len(value.Values) && effectiveBoundaryName(name.Name) {
				expressions = append(expressions, value.Values[i])
			}
		}
		return expressions
	case *ast.KeyValueExpr:
		if effectiveBoundaryName(expressionName(value.Key)) {
			return []ast.Expr{value.Value}
		}
	case *ast.CompositeLit:
		return unkeyedEffectiveFieldExpressions(value)
	case *ast.CallExpr:
		return effectiveCallArguments(value, parameterSinks, receiverTypes)
	}
	return nil
}

func unkeyedEffectiveFieldExpressions(literal *ast.CompositeLit) []ast.Expr {
	typeName, ok := literal.Type.(*ast.Ident)
	if !ok || typeName.Obj == nil {
		return nil
	}
	typeSpec, ok := typeName.Obj.Decl.(*ast.TypeSpec)
	if !ok {
		return nil
	}
	structure, ok := typeSpec.Type.(*ast.StructType)
	if !ok {
		return nil
	}
	var expressions []ast.Expr
	for position := range effectiveStructFieldIndexes(structure) {
		if position >= len(literal.Elts) {
			continue
		}
		if _, keyed := literal.Elts[position].(*ast.KeyValueExpr); !keyed {
			expressions = append(expressions, literal.Elts[position])
		}
	}
	return expressions
}

func effectiveCallArguments(call *ast.CallExpr, sinks map[string]map[int]bool, receiverTypes map[*calendarObject]string) []ast.Expr {
	name := expressionName(call.Fun)
	if strings.HasPrefix(name, "Resync") || strings.HasPrefix(name, "Detach") {
		return call.Args
	}
	var expressions []ast.Expr
	for position := range sinks[calendarCalledHelper(call, receiverTypes)] {
		if position < len(call.Args) {
			expressions = append(expressions, call.Args[position])
		}
	}
	return expressions
}

func effectiveBoundaryName(name string) bool {
	return name == "EffectiveFrom" || name == "effectiveFrom"
}

func findInstantDateConversions(fn *ast.FuncDecl, rel string, fset *token.FileSet, instantVars, scalarVars calendarVariables, scalarHelpers, instantHelpers, timePackages, timezonePackages map[string]bool) []calendarClockFinding {
	var findings []calendarClockFinding
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || !isImportedCall(call.Fun, timezonePackages, "DateFromTime") || len(call.Args) == 0 {
			return true
		}
		if expressionUsesCalendarInstant(call.Args[0], instantVars, instantHelpers, timePackages, timezonePackages) ||
			expressionContainsLiveInstantReconstruction(call.Args[0], scalarVars, instantVars, scalarHelpers, instantHelpers, timePackages, timezonePackages) {
			findings = append(findings, calendarClockFinding{
				file: rel, function: fn.Name.Name, line: fset.Position(call.Pos()).Line,
				risk: "live instant converted to a calendar date",
			})
		}
		return true
	})
	return findings
}
