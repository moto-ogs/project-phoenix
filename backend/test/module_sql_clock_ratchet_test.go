package test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// TestModuleSQLClockRatchet caps, per owner directory, the reads of the
// database clock in the SQL the production code of backend/modules/ and
// backend/workflows/ sends (#7104, ADR 0280).
//
// Why: an owner takes its clock from its composition (ADR 0239), and
// TestModuleLiveClockRatchet keeps the Go side of that. A query that writes
// or compares with NOW(), CURRENT_TIMESTAMP or CURRENT_DATE is a second
// clock no test can pin. Where one decision stamps on the one and compares on
// the other, it is wrong whenever the two differ: the owner slices of #7104
// found that in retention runs, visibility windows, cooldowns and check
// constraints, each only with Go and PostgreSQL moved to different days. New
// code passes the instant or the day of its clock as a query parameter. A
// decision that lives wholly on the database clock (it stamps and compares
// there, as the message retention of ADR 0277 does) is a named exception:
// its count stays, with the reason above the entry.
//
// Counted: occurrences of NOW(), CURRENT_TIMESTAMP, CURRENT_DATE,
// CURRENT_TIME, LOCALTIMESTAMP, LOCALTIME, clock_timestamp(),
// statement_timestamp() and transaction_timestamp(), in any case, inside the
// string literals of non-test .go files below modules/ and workflows/, per
// owner directory. A literal that is one lower-case word is a key, no query. Migrations are out of scope: column defaults and triggers
// are the schema's. Files built only with the testhooks tag are test support.
//
// Same budget semantics as moduleLiveClockBudget; shrink-only. A raise needs
// an ADR the entry cites.
//
// Seed: measured 2026-11-16 on development 436cec0402, after the owner
// slices of #7104 (802 reads in 26 owners); a mismatch prints the measured
// values.
var moduleSQLClockBudget = map[string]int{
	"modules/appointments": 2,
	"modules/auditlog":     17,
	"modules/carecontract": 2,
	// Includes the finished student document cleanups: their database function
	// guards the cutoff with the database clock (1.15.606).
	"modules/careplan": 20,
	// Includes the message retention of ADR 0277: the database stamps and
	// orders messages, so their retention compares on its clock too. And the
	// draft retention of the surveys (ADR 0281): the update trigger of
	// users.surveys stamps a draft's last change.
	"modules/communication":  20,
	"modules/enrollment":     64,
	"modules/exporttransfer": 10,
	"modules/facilities":     1,
	"modules/filestorage":    3,
	"modules/identityaccess": 31,
	// Includes the data return of ADR 0274: the database clock is the security
	// boundary of the release functions.
	"modules/organizationtenancy": 20,
	// Includes the age of the debtor number trails (ADR 0281): the database
	// stamps their entries by column default.
	"modules/parentbilling":             41,
	"modules/peopledirectory":           18,
	"modules/schedulerruntime":          11,
	"modules/schoolcalendar":            22,
	"modules/schoolmembership":          4,
	"modules/schoolstructure":           4,
	"modules/settings":                  20,
	"modules/staffannouncementaudience": 2,
	"modules/studentpresence":           16,
	// Includes CompletionTimestamp (ADR 0281): completed_at is ordered against
	// the updated_at of rows the database stamps.
	"modules/timetable": 4,
	// The finished staff document cleanups: their database function guards
	// the cutoff with the database clock (1.15.606). And the lift of a pool
	// block by the Träger (ADR 0281): the school lifts its blocks through the
	// database function workforce.pool_lift, which stamps lifted_at with
	// now(), so the Träger's lift stamps the column on the same clock.
	"modules/workforce": 2,
}

var sqlClockRead = regexp.MustCompile(`(?i)\b(?:now|clock_timestamp|statement_timestamp|transaction_timestamp)\s*\(\s*\)|\b(?:current_timestamp|current_date|current_time|localtimestamp|localtime)\b`)

// lowerCaseKey is a literal that is one lower-case word: a map key or log
// attribute such as "current_time", no SQL. SQL keywords written alone are
// upper case here ("CURRENT_TIMESTAMP" as a bun value).
var lowerCaseKey = regexp.MustCompile(`^[a-z_]+$`)

func TestModuleSQLClockRatchet(t *testing.T) {
	t.Parallel()

	root, err := findBackendRoot()
	if err != nil {
		t.Fatal(err)
	}
	measured, err := measureModuleSQLClock(root)
	if err != nil {
		t.Fatal(err)
	}
	if problems := compareModuleLiveClockBudget(measured, moduleSQLClockBudget); len(problems) > 0 {
		t.Errorf("SQL clock ratchet, the database clock read in a query (%d problem(s)):\n%s\n\n"+
			"\"direct clock call(s)\" are database clock reads here. Pass the instant or day of the owner's clock as a query parameter instead of NOW(), CURRENT_TIMESTAMP or CURRENT_DATE.\n\nmeasured:\n%s",
			len(problems), strings.Join(problems, "\n"), formatModuleLiveClockBudget(measured))
	}
}

// measureModuleSQLClock returns the database clock reads per owner directory.
func measureModuleSQLClock(root string) (map[string]int, error) {
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
			reads, err := countSQLClockReads(path)
			if err != nil || reads == 0 {
				return err
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			parts := strings.SplitN(filepath.ToSlash(rel), "/", 3)
			counts[parts[0]+"/"+parts[1]] += reads
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return counts, nil
}

// countSQLClockReads counts the database clock reads in the string literals
// of one file. Comments are no literals and do not count, and neither does a
// literal that is a lower-case key.
func countSQLClockReads(path string) (int, error) {
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
	reads := 0
	ast.Inspect(file, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		text, err := strconv.Unquote(literal.Value)
		if err != nil {
			return true
		}
		if lowerCaseKey.MatchString(text) {
			return true
		}
		reads += len(sqlClockRead.FindAllString(text, -1))
		return true
	})
	return reads, nil
}

func TestModuleSQLClockRatchetCountsLiteralsOnly(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeCalendarFixtureSourceAt(t, root, "modules/sample/internal/adapters/postgres/store.go", "package postgres\n"+
		"// NOW() in a comment is no query.\n"+
		"const expire = `UPDATE t SET ended_at = NOW(), day = current_date WHERE due < clock_timestamp ( )`\n"+
		"const pinned = `UPDATE t SET ended_at = ? WHERE due < ?`\n"+
		"var known = \"snow() is no clock, current_dates neither\"\n"+
		"var detail = map[string]string{\"current_time\": \"12:00\"}\n"+
		"var value = \"CURRENT_TIMESTAMP\"\n")
	writeCalendarFixtureSourceAt(t, root, "modules/sample/internal/adapters/postgres/store_test.go", "package postgres\n"+
		"const fixture = `SELECT NOW()`\n")
	writeCalendarFixtureSourceAt(t, root, "workflows/flow/hooks.go", "//go:build testhooks\n\npackage flow\n"+
		"const hook = `SELECT CURRENT_TIMESTAMP`\n")
	writeCalendarFixtureSourceAt(t, root, "workflows/flow/flow.go", "package flow\n"+
		"const lease = \"lease_until = CURRENT_TIMESTAMP + ?::interval\"\n")

	measured, err := measureModuleSQLClock(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(measured) != 2 || measured["modules/sample"] != 4 || measured["workflows/flow"] != 1 {
		t.Fatalf("measured %v, want modules/sample 4 and workflows/flow 1", measured)
	}
}
