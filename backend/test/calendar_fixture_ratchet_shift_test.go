package test

import (
	"go/ast"
	"go/token"
	"sort"
	"strconv"
	"strings"
)

// Gaps a and d of #4027: a live date or instant moved by whole days and
// handed to the code under test lands on a weekend, a holiday or in another
// year depending on the day CI runs (cc0e9a36e9: SubmitPickupChangeRequest
// with timezone.TodayDate().AddDays(3) on a Wednesday). The current day or
// instant alone is not a finding; the shift is. A shifted value flows
// through variables, struct literals, value transformations (formatting,
// encoding, request construction) and test helpers whose parameters reach
// code under test or the helper's result. SQL fixture writes are not code
// under test: they store the row without calendar validation.

const calendarShiftRisk = "live date shifted by days reaches the code under test"

type calendarShiftScope struct {
	fn                                            *ast.FuncDecl
	key                                           string
	helpers                                       calendarPackageHelpers
	timePackages, timezonePackages, valuePackages map[string]bool
	receiverTypes                                 map[*calendarObject]string
	dateVars, instantVars, carriers               calendarVariables
	// seeded scopes follow one helper parameter; live shifts inside the
	// helper are reported by the helper's own unseeded scope.
	seeded bool
}

func newCalendarShiftScope(fn *ast.FuncDecl, key string, helpers calendarPackageHelpers, timePackages, timezonePackages, valuePackages map[string]bool, seed *calendarObject) *calendarShiftScope {
	scope := &calendarShiftScope{
		fn: fn, key: key, helpers: helpers,
		timePackages: timePackages, timezonePackages: timezonePackages, valuePackages: valuePackages,
		receiverTypes: calendarReceiverTypes(fn),
		dateVars:      calendarVariables{}, instantVars: calendarVariables{}, carriers: calendarVariables{},
	}
	if seed != nil {
		scope.seeded = true
		scope.carriers[seed] = true
	} else {
		scope.dateVars = currentCalendarDateVariables(fn.Body, helpers.dates[key], timezonePackages)
		scope.collectLiveInstants()
	}
	scope.collectCarriers()
	return scope
}

// reseed reuses the prepared live values with fresh carriers after the
// helper registers changed.
func (s *calendarShiftScope) reseed(seed *calendarObject) *calendarShiftScope {
	next := *s
	next.carriers = calendarVariables{}
	next.seeded = seed != nil
	if seed != nil {
		next.carriers[seed] = true
	}
	next.collectCarriers()
	return &next
}

func (s *calendarShiftScope) findings(rel string, fset *token.FileSet) []calendarClockFinding {
	var findings []calendarClockFinding
	for _, call := range s.sinkCalls() {
		findings = append(findings, newCalendarClockFinding(rel, s.fn.Name.Name, fset.Position(call.Pos()).Line, calendarShiftRisk))
	}
	return findings
}

// sinkCalls are the calls of code under test that receive a shifted value,
// directly or through a helper parameter that reaches such a call.
func (s *calendarShiftScope) sinkCalls() []*ast.CallExpr {
	var calls []*ast.CallExpr
	ast.Inspect(s.fn.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if ok && s.receivesShift(call) {
			calls = append(calls, call)
		}
		return true
	})
	return calls
}

func (s *calendarShiftScope) receivesShift(call *ast.CallExpr) bool {
	if s.valueCall(call) || s.notCodeUnderTest(call) || calendarLocalClosureCall(call) || calendarComparisonCall(call) {
		return false
	}
	if identity, helper := s.helperIdentity(call); helper {
		return s.argumentsCarry(call, s.helpers.shiftSinks[s.key][identity])
	}
	for _, argument := range call.Args {
		if s.carries(argument) {
			return true
		}
	}
	return false
}

func (s *calendarShiftScope) argumentsCarry(call *ast.CallExpr, positions map[int]bool) bool {
	ordered := make([]int, 0, len(positions))
	for position := range positions {
		ordered = append(ordered, position)
	}
	sort.Ints(ordered)
	for _, position := range ordered {
		if position < len(call.Args) && s.carries(call.Args[position]) {
			return true
		}
	}
	return false
}

func (s *calendarShiftScope) helperIdentity(call *ast.CallExpr) (string, bool) {
	identity := calendarCalledHelper(call, s.receiverTypes)
	return identity, identity != "" && len(s.helpers.candidates[s.key][identity]) > 0
}

func (s *calendarShiftScope) carries(expr ast.Expr) bool {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Obj != nil && s.carriers[value.Obj]
	case *ast.CallExpr:
		return s.callCarries(value)
	case *ast.CompositeLit:
		for _, element := range value.Elts {
			if s.carries(element) {
				return true
			}
		}
		return false
	case *ast.KeyValueExpr:
		return s.carries(value.Value)
	case *ast.BinaryExpr:
		return s.carries(value.X) || s.carries(value.Y)
	case *ast.SelectorExpr:
		return !calendarIdentifierField(value.Sel.Name) && s.carries(value.X)
	default:
		inner := calendarWrappedExpression(expr)
		return inner != nil && s.carries(inner)
	}
}

// calendarWrappedExpression is the operand that keeps the value of a
// pointer, dereference, field, index, slice or type assertion expression.
func calendarWrappedExpression(expr ast.Expr) ast.Expr {
	switch value := expr.(type) {
	case *ast.UnaryExpr:
		return value.X
	case *ast.ParenExpr:
		return value.X
	case *ast.StarExpr:
		return value.X
	case *ast.SelectorExpr:
		return value.X
	case *ast.IndexExpr:
		return value.X
	case *ast.SliceExpr:
		return value.X
	case *ast.TypeAssertExpr:
		return value.X
	default:
		return nil
	}
}

func (s *calendarShiftScope) callCarries(call *ast.CallExpr) bool {
	if !s.seeded && s.liveShift(call) {
		return true
	}
	if selector, ok := call.Fun.(*ast.SelectorExpr); ok && s.carries(selector.X) {
		return true
	}
	if identity, helper := s.helperIdentity(call); helper {
		if !s.seeded && s.helpers.shifted[s.key][identity] {
			return true
		}
		return s.argumentsCarry(call, s.helpers.shiftPassthrough[s.key][identity])
	}
	if !s.valueCall(call) {
		return false
	}
	for _, argument := range call.Args {
		if s.carries(argument) {
			return true
		}
	}
	return false
}

// liveShift is AddDays/AddDate on a live date or instant, Add of a whole
// number of days on a live instant, Add of any duration on a live Berlin
// midnight (a wall-clock time that is an hour off on a clock-change day), or
// day arithmetic inside NewDate/Date.
func (s *calendarShiftScope) liveShift(call *ast.CallExpr) bool {
	if selector, ok := call.Fun.(*ast.SelectorExpr); ok {
		switch selector.Sel.Name {
		case "AddDays", "AddDate":
			return s.liveValue(selector.X)
		case "Add":
			return len(call.Args) == 1 && (calendarWholeDays(call.Args[0], s.timePackages) && s.liveValue(selector.X) || s.liveMidnight(selector.X))
		}
	}
	if !isImportedCall(call.Fun, s.timezonePackages, "NewDate") && !isImportedCall(call.Fun, s.timePackages, "Date") {
		return false
	}
	for _, argument := range call.Args {
		binary, ok := argument.(*ast.BinaryExpr)
		if ok && (binary.Op == token.ADD || binary.Op == token.SUB) && s.containsLiveValue(binary) {
			return true
		}
	}
	return false
}

// liveMidnight is calendar.Today() or BerlinMidnight() of a live date.
func (s *calendarShiftScope) liveMidnight(expr ast.Expr) bool {
	call, ok := ast.Unparen(expr).(*ast.CallExpr)
	if !ok {
		return false
	}
	if isImportedCall(call.Fun, s.timezonePackages, "Today") {
		return true
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	return ok && selector.Sel.Name == "BerlinMidnight" &&
		expressionUsesTodayDate(selector.X, s.dateVars, s.helpers.dates[s.key], s.timezonePackages)
}

func (s *calendarShiftScope) liveValue(expr ast.Expr) bool {
	return expressionUsesTodayDate(expr, s.dateVars, s.helpers.dates[s.key], s.timezonePackages) || s.liveInstant(expr)
}

func (s *calendarShiftScope) containsLiveValue(expr ast.Expr) bool {
	found := false
	ast.Inspect(expr, func(node ast.Node) bool {
		value, ok := node.(ast.Expr)
		found = found || (ok && s.liveValue(value))
		return !found
	})
	return found
}

var calendarInstantChainMethods = map[string]bool{
	"Add": true, "AddDate": true, "In": true, "Local": true, "Round": true, "Truncate": true, "UTC": true,
}

var calendarDateInstantMethods = map[string]bool{"BerlinMidnight": true, "EndOfDay": true, "UTCMidnight": true}

// liveInstant is stricter than expressionUsesCalendarInstant: the value
// itself is the clock reading (time.Now(), calendar.Today(), a live
// helper), a variable holding one, or an instant method chain on it.
func (s *calendarShiftScope) liveInstant(expr ast.Expr) bool {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Obj != nil && s.instantVars[value.Obj]
	case *ast.ParenExpr:
		return s.liveInstant(value.X)
	case *ast.CallExpr:
		if isLiveInstantSourceWithReceiverTypes(value, s.helpers.instants[s.key], s.timePackages, s.timezonePackages, s.receiverTypes) {
			return true
		}
		selector, ok := value.Fun.(*ast.SelectorExpr)
		if !ok {
			return false
		}
		if calendarDateInstantMethods[selector.Sel.Name] {
			return expressionUsesTodayDate(selector.X, s.dateVars, s.helpers.dates[s.key], s.timezonePackages)
		}
		return calendarInstantChainMethods[selector.Sel.Name] && s.liveInstant(selector.X)
	default:
		return false
	}
}

// calendarWholeDays matches durations such as 24*time.Hour, 48*time.Hour,
// -3*24*time.Hour or time.Duration(n)*24*time.Hour.
func calendarWholeDays(expr ast.Expr, timePackages map[string]bool) bool {
	hours, product, literal := false, 1, false
	for _, factor := range calendarDurationFactors(expr) {
		if isImportedSelector(factor, timePackages, "Hour") {
			hours = true
			continue
		}
		if number, ok := factor.(*ast.BasicLit); ok && number.Kind == token.INT {
			value, err := strconv.Atoi(number.Value)
			if err == nil {
				product, literal = product*value, true
			}
		}
	}
	return hours && literal && product != 0 && product%24 == 0
}

func calendarDurationFactors(expr ast.Expr) []ast.Expr {
	switch value := expr.(type) {
	case *ast.BinaryExpr:
		if value.Op != token.MUL {
			return nil
		}
		return append(calendarDurationFactors(value.X), calendarDurationFactors(value.Y)...)
	case *ast.ParenExpr:
		return calendarDurationFactors(value.X)
	case *ast.UnaryExpr:
		if value.Op == token.SUB || value.Op == token.ADD {
			return calendarDurationFactors(value.X)
		}
	}
	return []ast.Expr{expr}
}

func isImportedSelector(expr ast.Expr, packages map[string]bool, name string) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != name {
		return false
	}
	pkg, ok := selector.X.(*ast.Ident)
	return ok && pkg.Obj == nil && packages[pkg.Name]
}

var calendarBuiltinValueFunctions = map[string]bool{"append": true, "max": true, "min": true, "string": true}

// valueCall transforms a value without running code under test.
func (s *calendarShiftScope) valueCall(call *ast.CallExpr) bool {
	switch function := call.Fun.(type) {
	case *ast.Ident:
		return function.Obj == nil && calendarBuiltinValueFunctions[function.Name]
	case *ast.SelectorExpr:
		pkg, ok := function.X.(*ast.Ident)
		return ok && pkg.Obj == nil && s.valuePackages[pkg.Name]
	case *ast.ArrayType, *ast.MapType:
		return true
	default:
		return false
	}
}

var calendarTestingTypes = map[string]bool{"B": true, "F": true, "T": true, "TB": true}

// calendarSQLMethods mark a fixture write or read through bun or
// database/sql anywhere in the call chain.
var calendarSQLMethods = map[string]bool{
	"Exec": true, "ExecContext": true, "NewDelete": true, "NewInsert": true, "NewRaw": true,
	"NewSelect": true, "NewUpdate": true, "NewValues": true, "Query": true, "QueryContext": true,
	"QueryRow": true, "QueryRowContext": true,
}

// notCodeUnderTest is a call on the testing handle or a SQL fixture
// statement.
func (s *calendarShiftScope) notCodeUnderTest(call *ast.CallExpr) bool {
	expr := call.Fun
	for {
		switch value := expr.(type) {
		case *ast.SelectorExpr:
			if calendarSQLMethods[value.Sel.Name] {
				return true
			}
			expr = value.X
		case *ast.CallExpr:
			expr = value.Fun
		case *ast.Ident:
			return value.Obj != nil && calendarTestingTypes[calendarExpressionType(value, s.receiverTypes)]
		default:
			return false
		}
	}
}

func (s *calendarShiftScope) collectLiveInstants() {
	for changed := true; changed; {
		changed = false
		forEachCalendarAssignment(s.fn.Body, func(object *calendarObject, value ast.Expr) {
			if object != nil && !s.instantVars[object] && s.liveInstant(value) {
				s.instantVars[object], changed = true, true
			}
		})
	}
}

func (s *calendarShiftScope) collectCarriers() {
	for changed := true; changed; {
		changed = false
		forEachCalendarAssignment(s.fn.Body, func(object *calendarObject, value ast.Expr) {
			if object != nil && !s.carriers[object] && s.carries(value) {
				s.carriers[object], changed = true, true
			}
		})
	}
}

// forEachCalendarAssignment visits every assigned variable with its value:
// identifiers, the root variable of field and index assignments, all
// results of a single multi-value call, and range variables.
func forEachCalendarAssignment(body *ast.BlockStmt, visit func(*calendarObject, ast.Expr)) {
	ast.Inspect(body, func(node ast.Node) bool {
		switch statement := node.(type) {
		case *ast.AssignStmt:
			visitCalendarAssignStmt(statement, visit)
		case *ast.ValueSpec:
			for i, name := range statement.Names {
				if value := calendarAssignedValue(statement.Values, i); value != nil {
					visit(name.Obj, value)
				}
			}
		case *ast.RangeStmt:
			visit(calendarAssignedRoot(statement.Key), statement.X)
			visit(calendarAssignedRoot(statement.Value), statement.X)
		}
		return true
	})
}

func visitCalendarAssignStmt(statement *ast.AssignStmt, visit func(*calendarObject, ast.Expr)) {
	for i, lhs := range statement.Lhs {
		if value := calendarAssignedValue(statement.Rhs, i); value != nil {
			visit(calendarAssignedRoot(lhs), value)
		}
	}
}

func calendarAssignedValue(values []ast.Expr, i int) ast.Expr {
	if i < len(values) {
		return values[i]
	}
	if len(values) == 1 {
		return values[0]
	}
	return nil
}

func calendarAssignedRoot(expr ast.Expr) *calendarObject {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Obj
	case *ast.SelectorExpr:
		return calendarAssignedRoot(value.X)
	case *ast.IndexExpr:
		return calendarAssignedRoot(value.X)
	case *ast.StarExpr:
		return calendarAssignedRoot(value.X)
	default:
		return nil
	}
}

// calendarShiftHelper is one helper prepared for the shift fixed point:
// its live values are computed once, its carriers per iteration.
type calendarShiftHelper struct {
	key, identity string
	scope         *calendarShiftScope
	parameters    map[*calendarObject]int
}

// discoverCalendarShiftHelpers marks helpers that return a shifted live
// value and the parameter positions that reach code under test or the
// result, across files and test-support imports, until nothing changes.
func discoverCalendarShiftHelpers(candidates map[string][]calendarHelperCandidate, helpers calendarPackageHelpers) {
	var prepared []calendarShiftHelper
	for key, packageCandidates := range candidates {
		for _, candidate := range packageCandidates {
			prepared = append(prepared, calendarShiftHelper{
				key: key, identity: calendarHelperIdentity(candidate.receiver, candidate.name),
				scope: newCalendarShiftScope(candidate.fn, key, helpers,
					candidate.timePackages, candidate.timezonePackages, candidate.valuePackages, nil),
				parameters: calendarTraceableParameters(candidate.fn),
			})
		}
	}
	for changed := true; changed; {
		changed = false
		syncCalendarImportedHelpers(helpers)
		for _, helper := range prepared {
			changed = helper.mark(helpers) || changed
		}
	}
}

func (h calendarShiftHelper) mark(helpers calendarPackageHelpers) bool {
	changed := false
	if !helpers.shifted[h.key][h.identity] && functionReturns(h.scope.fn, h.scope.reseed(nil).carries) {
		helpers.shifted[h.key][h.identity], changed = true, true
	}
	for object, position := range h.parameters {
		sink := helpers.shiftSinks[h.key][h.identity][position]
		passthrough := helpers.shiftPassthrough[h.key][h.identity][position]
		if sink && passthrough {
			continue
		}
		seeded := h.scope.reseed(object)
		if !sink && len(seeded.sinkCalls()) > 0 {
			changed = markEffectiveParameterSink(helpers.shiftSinks[h.key], h.identity, position) || changed
		}
		if !passthrough && functionReturns(h.scope.fn, seeded.carries) {
			changed = markEffectiveParameterSink(helpers.shiftPassthrough[h.key], h.identity, position) || changed
		}
	}
	return changed
}

var calendarOpaqueParameterTypes = map[string]bool{
	"B": true, "Context": true, "DB": true, "F": true, "IDB": true, "T": true, "TB": true, "Tx": true,
	"bool": true, "error": true,
}

// calendarTraceableParameters skips parameters that cannot hold a date:
// testing handles, contexts, database handles, flags and functions.
func calendarTraceableParameters(fn *ast.FuncDecl) map[*calendarObject]int {
	parameters := calendarParameterPositions(fn.Type.Params)
	for object := range parameters {
		typeName := calendarObjectType(object, nil, calendarVariables{})
		if object == nil || typeName == "" || calendarOpaqueParameterTypes[typeName] {
			delete(parameters, object)
		}
	}
	return parameters
}

// calendarIdentifierField is a row ID read from a shifted fixture: the ID
// names the row and does not carry its date.
func calendarIdentifierField(name string) bool {
	return strings.HasSuffix(name, "ID") || strings.HasSuffix(name, "IDs") || strings.HasSuffix(name, "Id")
}

var calendarComparisonMethods = map[string]bool{
	"After": true, "Before": true, "Compare": true, "DaysUntil": true, "Equal": true, "Sub": true,
}

// calendarComparisonCall compares two values, as in an assertion.
func calendarComparisonCall(call *ast.CallExpr) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	return ok && calendarComparisonMethods[selector.Sel.Name]
}

// calendarLocalClosureCall calls a function literal declared in the test,
// such as an insert(at) fixture closure: test code, not code under test.
func calendarLocalClosureCall(call *ast.CallExpr) bool {
	function, ok := call.Fun.(*ast.Ident)
	if !ok || function.Obj == nil {
		return false
	}
	switch declaration := function.Obj.Decl.(type) {
	case *ast.AssignStmt:
		return calendarAssignsFunctionLiteral(declaration.Lhs, declaration.Rhs, function.Obj)
	case *ast.ValueSpec:
		names := make([]ast.Expr, len(declaration.Names))
		for i, name := range declaration.Names {
			names[i] = name
		}
		return calendarAssignsFunctionLiteral(names, declaration.Values, function.Obj)
	default:
		return false
	}
}

func calendarAssignsFunctionLiteral(names, values []ast.Expr, object *calendarObject) bool {
	for i, name := range names {
		identifier, ok := name.(*ast.Ident)
		if !ok || identifier.Obj != object || i >= len(values) {
			continue
		}
		_, literal := values[i].(*ast.FuncLit)
		return literal
	}
	return false
}
