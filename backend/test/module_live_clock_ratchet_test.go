package test

import (
	"fmt"
	"go/ast"
	"go/parser"
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
// time.Now as a value, as such a default does, is not counted.
//
// Counted: calls of time.Now and of calendar.TodayDate, calendar.Today and
// calendar.Now (package sharedkernel/calendar under any import name) in
// non-test .go files below modules/ and workflows/, per owner directory
// (modules/<owner>, workflows/<workflow>). time.Since and time.Until measure
// durations on the monotonic clock and are not counted. The roots (api,
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
var moduleLiveClockBudget = map[string]int{
	"modules/appointments":                 17,
	"modules/auditlog":                     20,
	"modules/carecontract":                 3,
	"modules/careplan":                     189,
	"modules/classday":                     14,
	"modules/communication":                39,
	"modules/dataimport":                   55,
	"modules/delivery":                     57,
	"modules/devicefleet":                  34,
	"modules/devicescan":                   6,
	"modules/documentrendering":            1,
	"modules/enrollment":                   67,
	"modules/facilities":                   16,
	"modules/feedback":                     8,
	"modules/filestorage":                  34,
	"modules/identityaccess":               269,
	"modules/mealplan":                     14,
	"modules/operatordashboard":            2,
	"modules/organizationtenancy":          37,
	"modules/parentbilling":                7,
	"modules/peopledirectory":              97,
	"modules/planexport":                   2,
	"modules/presenceprojection":           15,
	"modules/requestreview":                1,
	"modules/schedulerruntime":             42,
	"modules/schoolcalendar":               19,
	"modules/schoolmembership":             37,
	"modules/schoolstructure":              29,
	"modules/settings":                     5,
	"modules/staffannouncementaudience":    4,
	"modules/statistics":                   6,
	"modules/studentpresence":              207,
	"modules/timetable":                    159,
	"modules/traegerview":                  1,
	"modules/transactionruntime":           1,
	"modules/workforce":                    118,
	"workflows/catererportal":              2,
	"workflows/gradetransition":            1,
	"workflows/holidayclosurenotification": 1,
	"workflows/openroommove":               2,
	"workflows/parentportal":               19,
	"workflows/sessionend":                 1,
	"workflows/shiftplansync":              2,
	"workflows/staffoffboarding":           1,
	"workflows/studentdeletion":            1,
}

const calendarImportPath = "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

var liveCalendarClockFunctions = map[string]bool{"TodayDate": true, "Today": true, "Now": true}

func TestModuleLiveClockRatchet(t *testing.T) {
	t.Parallel()

	root, err := findBackendRoot()
	if err != nil {
		t.Fatal(err)
	}
	measured, err := measureModuleLiveClockCalls(root)
	if err != nil {
		t.Fatal(err)
	}
	if problems := compareModuleLiveClockBudget(measured, moduleLiveClockBudget); len(problems) > 0 {
		t.Errorf("live clock ratchet (%d problem(s)):\n%s\n\nmeasured:\n%s",
			len(problems), strings.Join(problems, "\n"), formatModuleLiveClockBudget(measured))
	}
}

func measureModuleLiveClockCalls(root string) (map[string]int, error) {
	counts := map[string]int{}
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
			calls, err := countLiveClockCalls(path)
			if err != nil || calls == 0 {
				return err
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			parts := strings.SplitN(filepath.ToSlash(rel), "/", 3)
			counts[parts[0]+"/"+parts[1]] += calls
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return counts, nil
}

// countLiveClockCalls counts direct clock calls in one file. Files built
// only with the testhooks tag are test support, not production code.
func countLiveClockCalls(path string) (int, error) {
	source, err := readGoSource(path)
	if err != nil {
		return 0, err
	}
	file, err := parser.ParseFile(sharedGoFileSet, path, source, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		return 0, err
	}
	if fileHasBuildTag(file, "testhooks") {
		return 0, nil
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
	calls := 0
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		pkg, ok := selector.X.(*ast.Ident)
		if !ok {
			return true
		}
		if timeNames[pkg.Name] && selector.Sel.Name == "Now" ||
			calendarNames[pkg.Name] && liveCalendarClockFunctions[selector.Sel.Name] {
			calls++
		}
		return true
	})
	return calls, nil
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
`)

	measured, err := measureModuleLiveClockCalls(root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"modules/sample": 3, "workflows/flow": 1}
	if fmt.Sprint(measured) != fmt.Sprint(want) {
		t.Fatalf("measured %v, want %v", measured, want)
	}
	problems := compareModuleLiveClockBudget(measured, map[string]int{"modules/sample": 2, "workflows/flow": 2, "modules/gone": 1})
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
	if problems := compareModuleLiveClockBudget(measured, map[string]int{"workflows/flow": 1}); len(problems) != 1 ||
		!strings.Contains(problems[0], "modules/sample: 3 direct clock call(s) and no budget") {
		t.Errorf("unbudgeted owner problems = %v", problems)
	}
}
