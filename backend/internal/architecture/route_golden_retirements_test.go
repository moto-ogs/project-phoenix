package architecture

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const goneRetirement = `[{"file":"gone/tokens.golden","routes":["DELETE /gone/expired"],"issue":2352}]`

// routeGoldenRetirementCase is one candidate change against a base whose
// golden holds gone/tokens.golden with the single route DELETE /gone/expired
// beside the fixture budget's own golden.
type routeGoldenRetirementCase struct {
	name       string
	baseRecord bool
	keepFile   bool
	// fixtureGolden replaces the candidate's fixture.golden when set.
	fixtureGolden string
	record, want  string
}

// TestCompareQueryBudgetsRetiresAGoldenFileOnlyWithAllItsRoutes pins the
// ADR 0160 addendum of 2026-11-20: a base golden file may disappear only under
// a record this change adds that names exactly its base routes, none of which
// the candidate golden still lists.
func TestCompareQueryBudgetsRetiresAGoldenFileOnlyWithAllItsRoutes(t *testing.T) {
	t.Parallel()
	for _, test := range []routeGoldenRetirementCase{
		{name: "file and route leave with record", record: goneRetirement},
		{name: "file leaves without record", want: "route golden gone/tokens.golden is missing"},
		{name: "record with wrong routes", record: strings.Replace(goneRetirement, "/gone/expired", "/gone/other", 1),
			want: "names DELETE /gone/other; the base file lists DELETE /gone/expired"},
		{name: "record with one route too many", record: strings.Replace(goneRetirement, `"DELETE /gone/expired"`, `"DELETE /gone/expired","GET /fixture/"`, 1),
			want: "the base file lists DELETE /gone/expired"},
		{name: "record for a file that still exists", keepFile: true, record: goneRetirement, want: "names a file the candidate golden still has"},
		{name: "record for a file the base lacks", keepFile: true, record: strings.Replace(goneRetirement, "gone/tokens", "gone/other", 1),
			want: "names a file the base golden does not have"},
		{name: "historical record grants nothing", baseRecord: true, record: goneRetirement, want: "route golden gone/tokens.golden is missing"},
		{name: "route moved to another file", fixtureGolden: "GET /fixture/\nGET /fixture/list\nDELETE /gone/expired\n", record: goneRetirement,
			want: "names a route the candidate golden still lists"},
		{name: "file outside the golden directory", record: strings.Replace(goneRetirement, "gone/tokens", "../tokens", 1), want: "read candidate route golden retirements"},
		{name: "unknown field", record: strings.Replace(goneRetirement, `"issue":2352`, `"issue":2352,"force":true`, 1), want: "unknown field"},
		{name: "duplicate file", record: `[` + goneRetirement[1:len(goneRetirement)-1] + `,` + goneRetirement[1:], want: "duplicate route golden retirement"},
		{name: "trailing data", record: goneRetirement + `[]`, want: "trailing data"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := compareRouteGoldenRetirementCase(t, test)
			if test.want == "" && err != nil || test.want != "" && (err == nil || !strings.Contains(err.Error(), test.want)) {
				t.Fatalf("want %q, got %v", test.want, err)
			}
		})
	}
}

func compareRouteGoldenRetirementCase(t *testing.T, test routeGoldenRetirementCase) error {
	t.Helper()
	repo, _ := ratchetRepository(t, legacyRecord(2583))
	routes := filepath.Join(repo, routeGoldenDirectory)
	gone := filepath.Join(routes, "gone", "tokens.golden")
	record := filepath.Join(repo, routeGoldenRetirementsPath)
	writeFile(t, gone, "DELETE /gone/expired\n")
	if test.baseRecord {
		writeFile(t, record, goneRetirement)
	}
	runGit(t, repo, "add", "-A")
	runGit(t, repo, "commit", "-qm", "route golden retirement base")
	base := strings.TrimSpace(runGit(t, repo, "rev-parse", "HEAD"))
	if !test.keepFile {
		if err := os.Remove(gone); err != nil {
			t.Fatal(err)
		}
	}
	if test.fixtureGolden != "" {
		writeFile(t, filepath.Join(routes, "fixture.golden"), test.fixtureGolden)
	}
	if test.record != "" {
		writeFile(t, record, test.record)
	}
	return CompareQueryBudgets(repo, base)
}

// TestCompareQueryBudgetsRetiresABudgetWithItsRetiredGoldenFile: the routes
// of a retired file still count as base routes, so the budget of its route
// retires with it in the same change.
func TestCompareQueryBudgetsRetiresABudgetWithItsRetiredGoldenFile(t *testing.T) {
	t.Parallel()
	repo, _ := ratchetRepository(t, legacyRecord(2583))
	routes := filepath.Join(repo, routeGoldenDirectory)
	writeFile(t, filepath.Join(routes, "fixture.golden"), "GET /fixture/\n")
	writeFile(t, filepath.Join(routes, "list.golden"), "GET /fixture/list\n")
	writeFile(t, filepath.Join(repo, "test", "query-budgets", "owner", "other.json"), strings.Replace(strings.Replace(queryBudgetFragment, "fixture.list", "fixture.kept", 1), `"route":"GET /fixture/list"`, `"route":"GET /fixture/"`, 1))
	runGit(t, repo, "add", "-A")
	runGit(t, repo, "commit", "-qm", "single-route golden base")
	base := strings.TrimSpace(runGit(t, repo, "rev-parse", "HEAD"))
	if err := os.Remove(filepath.Join(routes, "list.golden")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(repo, "test", "query-budgets", "owner", "list.json")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(repo, routeGoldenRetirementsPath), `[{"file":"list.golden","routes":["GET /fixture/list"],"issue":2352}]`)
	if err := CompareQueryBudgets(repo, base); err == nil || !strings.Contains(err.Error(), "fixture.list disappeared") {
		t.Fatalf("a retired golden file alone must not retire the budget: %v", err)
	}
	writeFile(t, filepath.Join(repo, queryBudgetRetirementsPath), fixtureRetirement)
	if err := CompareQueryBudgets(repo, base); err != nil {
		t.Fatalf("budget and golden file retire together: %v", err)
	}
}
