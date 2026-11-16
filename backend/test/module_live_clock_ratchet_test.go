package test

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// TestModuleLiveClockRatchet caps the direct reads of the real clock in the
// production code of backend/modules/ and backend/workflows/ (#4027).
//
// Why: a service that calls time.Now() or calendar.TodayDate() itself
// cannot be tested on a fixed day. Its tests pin a clock that the service
// never reads, pass on the day they were written and fail on a weekend, a
// holiday, a clock change or once a fixed fixture date lies in the past.
// About 60 of the 77 fixed-date failures of the #4027 audit had that cause.
// New code takes the clock from its composition: a `now func() time.Time`
// dependency (calendar.CalendarDateClock turns it into a day clock), which
// the root wires to time.Now and tests to a fixed instant. Referencing
// time.Now as a value is not a call; moduleLiveClockValueBudget below caps it
// outside the owner's compositions.
//
// Counted: calls of time.Now and of calendar.TodayDate, calendar.Today and
// calendar.Now (package sharedkernel/calendar under any import name) in
// non-test .go files below modules/ and workflows/, per owner directory
// (modules/<owner>, workflows/<workflow>). time.Since and time.Until measure
// durations on the monotonic clock and are not counted, and so is a
// stopwatch start: a time.Now() assigned to a local variable that is only
// ever read by time.Since (stopwatchStarts, #7104). The roots (api,
// roots, cmd) wire the real clock and are out of scope.
//
// Budget semantics, as the other owner ratchets in this package:
//   - An owner over its budget fails: inject the clock instead.
//   - An owner under its budget fails until the entry is lowered.
//   - An owner with calls and no entry fails; an entry without calls fails
//     so it gets deleted.
//
// Seed: measured 2026-11-14 on development 08ff7ba887 with this test
// (a mismatch prints the measured values):
//
//	cd backend && ../scripts/run-go-toolchain.sh go test -tags=testhooks ./test/ \
//	  -run '^TestModuleLiveClockRatchet$' -count=1 -v
//
// Re-measured 2026-11-15 for #7104: not counting stopwatch starts and the
// owner slices lowered the sum from 1,646 to 665 calls; Care Plan (139 to 1)
// and Parent Billing (7 to 0) take their clocks from their compositions.
// Workforce (62 to 0, ADR 0264) reads the clock of its composition too.
// Student Presence (86), Presence Projection (15) and Class Day (14) follow
// with ADR 0262 (115 to 0).
// Identity & Access (83 to 14, ADR 0261) keeps fourteen.
// portalauth.PasswordResetRetryAfter is the RetryAfter func(error) of
// api/common's PasswordResetRoutes, which five portal routers build without
// a clock; sessiontoken's decode serves the package-level middleware
// (ParseVerified, Authenticator, AuthenticateRefreshJWT, RateLimitKey), which
// names no clock, behind the jwtauth verifier that checks exp on the jwx clock.
// Five compare a passkey ceremony's expiry, which go-webauthn stamps and
// validates on the real clock: verifyRegistration and consumeLoginSession of
// AccountPasskeyFlows, verifyRegistration and verifyLogin of
// OperatorPasskeyFlows, and SignInDataRetention's
// inUnitDeleteExpiredPasskeySessions. Seven stamp or compare the iat and exp of
// tokens the jwtauth verifier checks on the jwx clock: SessionCodec's
// AccountOfAccessToken, IssueTokenPair, IssueAccessToken,
// IssueMFAEnrollmentToken and ParseAccessToken, TokenAuth.ParseAccessJWT and
// the access-token expiry in AccountAuthentication.ValidateSessionTokens.
var moduleLiveClockBudget = map[string]int{
	// PickupBaselineQueries.HasBookedOfferingPickupForWeekday: the public
	// PickupBaselineReader method names no day.
	"modules/careplan": 1,
	// service.enqueueLetterRetry: the nanosecond only makes each retry's
	// idempotency key unique; a pinned clock would give two retries one key
	// and the outbox would swallow the second as a duplicate.
	"modules/communication": 1,
	// Resource.sendTestNotification: the nanosecond only makes the key of
	// each test notification unique, as in Communication.
	// Resource.startSchoolStream and schoolDeliver: the access re-check of
	// an open school stream runs on the elapsed time since the last check; a
	// pinned clock would never re-check. RealtimePublisher.recordDrop: the
	// interval between two drop log lines. usageService.SnapshotUsage: the
	// age of the cached usage snapshot (time.Since).
	"modules/delivery": 5,
	// records.GeneratedAtLabel: the public formatting function prints the
	// moment of rendering for a zero creation time, and the renderer is also
	// built bare (&RendererService{}), so it holds no clock to pass.
	"modules/documentrendering": 1,
	"modules/identityaccess":    14,
	// leadership (acquire, renew, step, expire, current, stepDown and
	// newLeadership): the lease term is a local monotonic deadline armed as
	// timers, and the standby time is measured since the last term.
	// Scheduler.waitUntilNextMinute: the timer that aligns the minute tick
	// with the wall clock. A pinned clock would stop both.
	"modules/schedulerruntime":             11,
	"workflows/catererportal":              2,
	"workflows/holidayclosurenotification": 1,
	"workflows/parentportal":               19,
	"workflows/shiftplansync":              2,
}

// moduleLiveClockValueBudget caps, per owner directory, the references to the
// real clock that are not calls and stand outside the owner's compositions:
// `now: time.Now`, `clock := calendar.TodayDate`, `if now == nil { now =
// time.Now }` in an application, adapter, HTTP or domain package (#7104).
//
// Why: such a binding passes the call ratchet above, because nothing calls
// the clock there, and still decides on the real day. The owner slices of
// #7104 left the budget of calls at zero for an owner while a constructor
// kept its own `time.Now`, a root passed no clock, and a pinned test ran on
// two clocks. The real clock is named in two places only: the roots (api,
// roots, cmd) and an owner's compose or composition package, which may default
// a clock the root left unset (ADR 0239). Everything else receives it.
//
// Same budget semantics as moduleLiveClockBudget; shrink-only.
//
// Seed: measured 2026-11-16 on development after the owner slices of #7104.
var moduleLiveClockValueBudget = map[string]int{}

const calendarImportPath = "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

var liveCalendarClockFunctions = map[string]bool{"TodayDate": true, "Today": true, "Now": true}

func TestModuleLiveClockRatchet(t *testing.T) {
	t.Parallel()

	root, err := findBackendRoot()
	if err != nil {
		t.Fatal(err)
	}
	measured, bound, err := measureModuleLiveClock(root)
	if err != nil {
		t.Fatal(err)
	}
	if problems := compareModuleLiveClockBudget(measured, moduleLiveClockBudget); len(problems) > 0 {
		t.Errorf("live clock ratchet (%d problem(s)):\n%s\n\nmeasured:\n%s",
			len(problems), strings.Join(problems, "\n"), formatModuleLiveClockBudget(measured))
	}
	if problems := compareModuleLiveClockBudget(bound, moduleLiveClockValueBudget); len(problems) > 0 {
		t.Errorf("live clock value ratchet, the real clock bound as a value outside a composition (%d problem(s)):\n%s\n\n"+
			"Pass the clock in from the owner's compose package or the root instead of naming time.Now or calendar.TodayDate here.\n\nmeasured:\n%s",
			len(problems), strings.Join(problems, "\n"), formatModuleLiveClockBudget(bound))
	}
}

// measureModuleLiveClock returns, per owner directory, the direct clock calls
// and the references to the real clock as a value outside the owner's
// compositions.
func measureModuleLiveClock(root string) (map[string]int, map[string]int, error) {
	counts, bound := map[string]int{}, map[string]int{}
	for _, top := range []string{"modules", "workflows"} {
		err := filepath.WalkDir(filepath.Join(root, top), func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				if strings.HasPrefix(entry.Name(), ".") || entry.Name() == "testdata" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			calls, values, err := countLiveClockUses(path)
			if err != nil || calls+values == 0 {
				return err
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			parts := strings.SplitN(rel, "/", 3)
			owner := parts[0] + "/" + parts[1]
			if calls > 0 {
				counts[owner] += calls
			}
			if values > 0 && !inOwnerComposition(rel) {
				bound[owner] += values
			}
			return nil
		})
		if err != nil {
			return nil, nil, err
		}
	}
	return counts, bound, nil
}

// inOwnerComposition reports whether a file belongs to a package that
// composes its owner (a compose or composition directory, ADR 0068).
func inOwnerComposition(rel string) bool {
	for _, segment := range strings.Split(filepath.ToSlash(filepath.Dir(rel)), "/") {
		if segment == "compose" || segment == "composition" {
			return true
		}
	}
	return false
}

// countLiveClockUses counts, in one file, the direct clock calls and the
// references to a clock function that are not calls (`now: time.Now`,
// `clock := calendar.TodayDate`). Files built only with the testhooks tag are
// test support, not production code.
func countLiveClockUses(path string) (int, int, error) {
	source, err := readGoSource(path)
	if err != nil {
		return 0, 0, err
	}
	file, err := parser.ParseFile(sharedGoFileSet, path, source, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		return 0, 0, err
	}
	if fileHasBuildTag(file, "testhooks") {
		return 0, 0, nil
	}
	timeNames, calendarNames := map[string]bool{}, map[string]bool{}
	for _, spec := range file.Imports {
		importPath, _ := strconv.Unquote(spec.Path.Value)
		name := pathBase(importPath)
		if spec.Name != nil {
			name = spec.Name.Name
		}
		switch importPath {
		case "time":
			timeNames[name] = true
		case calendarImportPath:
			calendarNames[name] = true
		}
	}
	isLiveClock := func(expr ast.Expr) bool {
		selector, ok := expr.(*ast.SelectorExpr)
		if !ok {
			return false
		}
		pkg, ok := selector.X.(*ast.Ident)
		return ok && (timeNames[pkg.Name] && selector.Sel.Name == "Now" ||
			calendarNames[pkg.Name] && liveCalendarClockFunctions[selector.Sel.Name])
	}
	stopwatches := stopwatchStarts(file, timeNames)
	called := map[ast.Expr]bool{}
	calls, values := 0, 0
	ast.Inspect(file, func(node ast.Node) bool {
		if call, ok := node.(*ast.CallExpr); ok && isLiveClock(call.Fun) {
			called[call.Fun] = true
			if !stopwatches[call] {
				calls++
			}
		}
		return true
	})
	ast.Inspect(file, func(node ast.Node) bool {
		if expr, ok := node.(ast.Expr); ok && !called[expr] && isLiveClock(expr) {
			values++
		}
		return true
	})
	return calls, values, nil
}

// stopwatchStarts returns the time.Now calls that only start a duration
// measurement: each is assigned inside a function to a variable declared in
// that function, and every other reference to that name in the function is
// either the sole argument of time.Since or the target of another such start
// read. time.Since reads the clock again, so a fixed test clock cannot change
// what such a variable measures. A variable that is passed on, compared or
// stored stays counted, because the code then decides on the instant itself.
// Names are matched per function without resolving shadowing: a name reused
// for anything else in the same function counts all its start reads, and
// package-level variables are never stopwatches.
func stopwatchStarts(file *ast.File, timeNames map[string]bool) map[*ast.CallExpr]bool {
	result := map[*ast.CallExpr]bool{}
	for _, decl := range file.Decls {
		if function, ok := decl.(*ast.FuncDecl); ok && function.Body != nil {
			for call := range functionStopwatchStarts(function, timeNames) {
				result[call] = true
			}
		}
	}
	return result
}

func functionStopwatchStarts(function *ast.FuncDecl, timeNames map[string]bool) map[*ast.CallExpr]bool {
	isTimeCall := func(expr ast.Expr, name string) (*ast.CallExpr, bool) {
		call, ok := expr.(*ast.CallExpr)
		if !ok {
			return nil, false
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != name {
			return nil, false
		}
		pkg, ok := selector.X.(*ast.Ident)
		return call, ok && timeNames[pkg.Name]
	}
	declared := map[string]bool{}
	starts := map[string][]*ast.CallExpr{}
	allowed := map[*ast.Ident]bool{}
	record := func(target *ast.Ident, value ast.Expr) {
		if call, ok := isTimeCall(value, "Now"); ok && len(call.Args) == 0 {
			starts[target.Name] = append(starts[target.Name], call)
			allowed[target] = true
		}
	}
	ast.Inspect(function, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.AssignStmt:
			if node.Tok == token.DEFINE {
				for _, lhs := range node.Lhs {
					if ident, ok := lhs.(*ast.Ident); ok {
						declared[ident.Name] = true
					}
				}
			}
			if len(node.Lhs) == 1 && len(node.Rhs) == 1 {
				if target, ok := node.Lhs[0].(*ast.Ident); ok {
					record(target, node.Rhs[0])
				}
			}
		case *ast.ValueSpec:
			for _, name := range node.Names {
				declared[name.Name] = true
			}
			if len(node.Names) == 1 && len(node.Values) == 1 {
				record(node.Names[0], node.Values[0])
			}
		case *ast.Field:
			for _, name := range node.Names {
				declared[name.Name] = true
			}
		case *ast.CallExpr:
			if _, ok := isTimeCall(node, "Since"); ok && len(node.Args) == 1 {
				if arg, ok := node.Args[0].(*ast.Ident); ok {
					allowed[arg] = true
				}
			}
		}
		return true
	})
	disqualified := map[string]bool{}
	ast.Inspect(function, func(node ast.Node) bool {
		if ident, ok := node.(*ast.Ident); ok && starts[ident.Name] != nil && !allowed[ident] {
			disqualified[ident.Name] = true
		}
		return true
	})
	result := map[*ast.CallExpr]bool{}
	for name, calls := range starts {
		if !declared[name] || disqualified[name] {
			continue
		}
		for _, call := range calls {
			result[call] = true
		}
	}
	return result
}

func fileHasBuildTag(file *ast.File, tag string) bool {
	for _, group := range file.Comments {
		if group.Pos() > file.Package {
			break
		}
		for _, comment := range group.List {
			if strings.HasPrefix(comment.Text, "//go:build ") &&
				strings.Contains(" "+strings.TrimPrefix(comment.Text, "//go:build ")+" ", " "+tag+" ") {
				return true
			}
		}
	}
	return false
}

func pathBase(importPath string) string {
	if i := strings.LastIndex(importPath, "/"); i >= 0 {
		return importPath[i+1:]
	}
	return importPath
}

func compareModuleLiveClockBudget(measured, budget map[string]int) []string {
	var problems []string
	for owner, calls := range measured {
		limit, ok := budget[owner]
		switch {
		case !ok:
			problems = append(problems, fmt.Sprintf("%s: %d direct clock call(s) and no budget; inject the clock instead", owner, calls))
		case calls > limit:
			problems = append(problems, fmt.Sprintf("%s: %d direct clock calls, budget %d; inject the clock instead of raising it", owner, calls, limit))
		case calls < limit:
			problems = append(problems, fmt.Sprintf("%s: %d direct clock calls, budget %d; lower the budget to %d", owner, calls, limit, calls))
		}
	}
	for owner := range budget {
		if _, ok := measured[owner]; !ok {
			problems = append(problems, fmt.Sprintf("%s: no direct clock calls left; delete its budget entry", owner))
		}
	}
	sort.Strings(problems)
	return problems
}

func formatModuleLiveClockBudget(counts map[string]int) string {
	owners := make([]string, 0, len(counts))
	for owner := range counts {
		owners = append(owners, owner)
	}
	sort.Strings(owners)
	var out strings.Builder
	for _, owner := range owners {
		fmt.Fprintf(&out, "\t%q: %d,\n", owner, counts[owner])
	}
	return out.String()
}

func TestModuleLiveClockRatchetCountsCallsNotReferences(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeCalendarFixtureSourceAt(t, root, "modules/sample/service.go", `package sample
import (
	stdtime "time"
	tz "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)
type Service struct{ now func() stdtime.Time }
func New() *Service { return &Service{now: stdtime.Now} }
func (s *Service) Day() tz.Date { return tz.TodayDate() }
func (s *Service) Stamp() stdtime.Time { return stdtime.Now() }
func (s *Service) Elapsed(start stdtime.Time) stdtime.Duration { return stdtime.Since(start) }
func (s *Service) Midnight() stdtime.Time { return tz.Today() }
func (s *Service) Injected() tz.Date { return tz.DateFromTime(s.now()) }
`)
	writeCalendarFixtureSourceAt(t, root, "modules/sample/service_test.go", `package sample
import "time"
func helper() time.Time { return time.Now() }
`)
	writeCalendarFixtureSourceAt(t, root, "modules/sample/hooks.go", `//go:build testhooks

package sample
import "time"
func hook() time.Time { return time.Now() }
`)
	writeCalendarFixtureSourceAt(t, root, "workflows/flow/flow.go", `package flow
import "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
func run() { _ = calendar.Now() }
var day = calendar.TodayDate
`)
	// The real clock as a value: counted in an application package, allowed
	// in the owner's composition.
	writeCalendarFixtureSourceAt(t, root, "modules/sample/compose/new.go", `package compose
import "time"
func clockOrReal(now func() time.Time) func() time.Time {
	if now == nil {
		return time.Now
	}
	return now
}
`)
	writeCalendarFixtureSourceAt(t, root, "modules/sample/internal/application/service.go", `package application
import "time"
type service struct{ now func() time.Time }
func newService(now func() time.Time) *service {
	if now == nil {
		now = time.Now
	}
	return &service{now: now}
}
`)
	// Stopwatches: a start read only ever measured with time.Since is not a
	// clock the code decides on. Any other use of the name in the function
	// counts it (shadowed: both), and a package-level variable always counts.
	writeCalendarFixtureSourceAt(t, root, "workflows/timed/timed.go", `package timed
import "time"
func observe(time.Duration) {}
func record(time.Time) {}
func measured() {
	started := time.Now()
	observe(time.Since(started))
	started = time.Now()
	defer func() { observe(time.Since(started)) }()
	var begin = time.Now()
	observe(time.Since(begin))
}
func forwarded() {
	started := time.Now()
	record(started)
}
func compared() {
	started := time.Now()
	observe(time.Since(started))
	if started.Weekday() == time.Sunday {
		return
	}
}
func shadowed() {
	started := time.Now()
	observe(time.Since(started))
	{
		started := time.Now()
		record(started)
	}
}
var since = time.Now()
func packageLevel() {
	observe(time.Since(since))
	since = time.Now()
}
`)

	measured, bound, err := measureModuleLiveClock(root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"modules/sample": 3, "workflows/flow": 1, "workflows/timed": 6}
	if fmt.Sprint(measured) != fmt.Sprint(want) {
		t.Fatalf("measured %v, want %v", measured, want)
	}
	// modules/sample: `now: stdtime.Now` in service.go and the nil default in
	// internal/application; its compose package is not counted.
	wantBound := map[string]int{"modules/sample": 2, "workflows/flow": 1}
	if fmt.Sprint(bound) != fmt.Sprint(wantBound) {
		t.Fatalf("bound as a value %v, want %v", bound, wantBound)
	}
	problems := compareModuleLiveClockBudget(measured, map[string]int{"modules/sample": 2, "workflows/flow": 2, "workflows/timed": 6, "modules/gone": 1})
	joined := strings.Join(problems, "\n")
	for _, fragment := range []string{
		"modules/sample: 3 direct clock calls, budget 2; inject",
		"workflows/flow: 1 direct clock calls, budget 2; lower the budget to 1",
		"modules/gone: no direct clock calls left",
	} {
		if !strings.Contains(joined, fragment) {
			t.Errorf("problems %q lack %q", joined, fragment)
		}
	}
	if problems := compareModuleLiveClockBudget(measured, map[string]int{"workflows/flow": 1, "workflows/timed": 6}); len(problems) != 1 ||
		!strings.Contains(problems[0], "modules/sample: 3 direct clock call(s) and no budget") {
		t.Errorf("unbudgeted owner problems = %v", problems)
	}
}
