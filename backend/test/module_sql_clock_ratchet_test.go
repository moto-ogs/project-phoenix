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
	// databaseClock (1), the package's one read of the database clock (ADR
	// 0281, Nachtrag): the security-definer retention functions guard the
	// windows of the auth events, the access log, the deletion log, the
	// student change log and the ten protocols on the database clock, so the
	// column defaults stamp these ledgers, and the change ledgers the access
	// trail orders against them, in every writer; their cutoffs count back
	// from DatabaseTime, read once per retention step, and so does the
	// window of the cleanup statistics. The access-log deduplication and the
	// end of the Träger access trail read the same clock. The consent changes
	// keep the time their producer sets, the date of the grant. The column defaults also stamp the ledgers without a school
	// (operator ledger, Träger account ledger, Träger document downloads),
	// whose cutoff the database computes.
	"modules/auditlog": 1,
	// Only the finished student document cleanups (1): their database
	// function guards the cutoff with the database clock (1.15.606).
	"modules/careplan": 1,
	// Named exceptions on the database clock: the message retention of ADR
	// 0277 (7), since PostgreSQL stamps and orders the messages and threads;
	// the unsent uploads (1), stamped by column default, and the settled
	// cleanup intents with their cleaned_at stamp (2), also ADR 0277; the
	// history_from of a team group participant (1), compared with message
	// stamps; the read cursor of a group thread (1), whose column default is
	// clock_timestamp() like its messages; the close of a group thread (1),
	// stamped beside its trigger-stamped updated_at; the team's unread mark
	// (1), a compare-and-swap against its own stamp, and the notification
	// throttle (2), stamped and compared there so every host agrees; the
	// draft retention of the surveys (1, ADR 0281), against the trigger-
	// stamped updated_at; and published_at of the operator announcements
	// (1), which staffannouncementaudience orders against database-stamped
	// created_at of schools, memberships and accounts (ADR 0281).
	"modules/communication": 18,
	// The unregistered tag scans (1, ADR 0281, Nachtrag): the column default
	// stamps scanned_at and audit.delete_expired_unregistered_tag_scans guards
	// the 90-day window on the database clock, so the cutoff counts back from
	// DatabaseTime.
	"modules/devicefleet": 1,
	// Named exceptions on the database clock (ADR 0281): the read state of
	// requests (3), where read_at and parent_changed_at are stamped there and
	// only compared with each other; family_children_stated_at (1), which
	// parentbilling orders against its own clock_timestamp() stamps of the
	// family children; and promoted_at of a holiday booking (1), whose Berlin
	// day the host's booked days compare with the day of the rebooking in
	// the holiday audit, which the column default stamps there.
	"modules/enrollment": 5,
	// Named exceptions on the database clock: the two-minute fences of the
	// school and Träger handover journals, which the claim and completion
	// functions of the migrations stamp and compare with clock_timestamp().
	// The intent sets the fence (2), the Träger's recipient list and journal
	// read it as expired (2), and the recovery settles expired attempts of
	// both journals with their updated_at (4). parentbilling judges its export
	// handovers against these fences. And the cutoff of the journal retention
	// (1): the database stamps the journal and its deletion function guards
	// the window with clock_timestamp().
	"modules/exporttransfer": 9,
	// databaseClock (1, ADR 0281, Nachtrag): the finished file and attachment
	// cleanups and the removed files: their security-definer functions guard
	// the cutoff with the database clock (1.15.606), so the cutoff is taken
	// from statement_timestamp().
	"modules/filestorage": 1,
	// The Springer access windows (3, ADR 0251): the security-definer
	// function auth.account_tenant_admitted admits a window on the database
	// clock, so the prune of ended windows reads that clock too. And the
	// deletion of deactivated operators (1): a trigger stamps
	// platform.operators.deactivated_at with now(), so its cutoff compares on
	// the database clock (ADR 0281). And databaseClock (1, ADR 0285), the
	// package's one read for the caterer invitations:
	// auth.create_invited_caterer accepts only while expires_at >
	// statement_timestamp(), so expiry, the open checks, preview,
	// acceptance, accepted_at, revoked_at and their retention read that clock
	// once per operation.
	"modules/identityaccess": 5,
	// Named exceptions on the database clock (ADR 0281): deleted_at of
	// platform.schools (4), which the demo retirement functions stamp with
	// now() and the demo database erasure ages with clock_timestamp(), so the
	// operator's soft delete, the retire and failure of a demo order and the
	// hour before the demo file erasure use the same clock; the reads of the
	// Träger documents (2), stamped by column default and pruned after three
	// years like the school functions of migration 1.15.795 prune them; the
	// erasure orders (3), whose started_at and completed_at
	// platform.erase_organization stamps and whose retention compares
	// withdrawn_at with clock_timestamp(), so withdrawal and the evidence of the
	// records hint stay on that ledger's clock; logo_updated_at (1), set in
	// the statement whose trigger stamps updated_at of the same profile; and
	// the export manifest (1), which names the instant of its REPEATABLE READ
	// snapshot. And the data return (3, ADR 0274, raised by ADR 0284): its
	// release functions bound keep_until and expires_at
	// against now(), so release, grant and retrieval decide on that clock
	// too: databaseNow reads it once per decision (1), countDownload spends a
	// download only while expires_at > now() (1), and finishDownload stamps
	// finished_at like the started_at default (1).
	"modules/organizationtenancy": 14,
	// Named exceptions on the database clock (ADR 0281): the family children
	// statement and confirmation (5), ordered against the statement time
	// enrollment stamps with clock_timestamp(); the download of a PAIN.008
	// file (1), which delete_expired_sepa_debit_downloads expires on its
	// clock; the release of holiday and monthly runs and the submission of
	// debits (4), which the invoice history and the export run list order
	// against stamps of column defaults; the start and settlement of an export
	// handover (2), judged against the transport's fences that lease on the
	// database clock; and the age of the Beleg deletion log (1), whose entries
	// parent_billing.log_removed_belege stamps by column default.
	"modules/parentbilling": 13,
	// The worker leases of platform.worker_leases (11): several API and worker
	// processes coordinate through one database, so its clock is the lease
	// clock; acquire, renew and release stamp and compare lease_until and
	// updated_at there.
	"modules/schedulerruntime": 11,
	// The holiday closure commands of ADR 0273 (20): lease, due time and
	// watchdog read one clock, PostgreSQL's. On it the commands also stamp
	// processed_at (the watchdog's age) and completed_at, which the notice
	// list (14 days) and the retirement (30 days) compare together with
	// processed_at, and the confirmed_at, requested_at and prepared_at that
	// the same statements set beside next_attempt_at and processed_at.
	"modules/schoolcalendar": 20,
	// The automatic deletion of staff (2, ADR 0281 point 3): the retirement
	// stamps deleted_at with NOW(), and the cutoff counts from the day of
	// clock_timestamp(), because users.erase_retired_staff_records (1.15.459)
	// compares that column with the cutoff and guards the cutoff with its
	// own clock.
	"modules/schoolmembership": 2,
	// draftCutoff (1, ADR 0281 point 3): the trigger stamps updated_at of a
	// draft grade transition, so the retention counts a draft's window back
	// from the database's Berlin day; applied and reverted transitions keep
	// the owner's cutoff on their owner-stamped times.
	"modules/schoolstructure": 1,
	// The visibility window of the operator announcements (2, ADR 0281):
	// communication stamps published_at with CURRENT_TIMESTAMP, and the
	// projection orders it against the created_at of schools, memberships
	// and accounts, which the database stamps.
	"modules/staffannouncementaudience": 2,
	// Named exception on the database clock (ADR 0281): statementClock (1),
	// the one clock_timestamp() that stamps updated_at of
	// active.activity_session_attendance in every writer (UPDATE, INSERT, ON
	// CONFLICT), and of an activity session on reopen, whose completion
	// stamps it with completed_at. Timetable's Reopen orders the attendance
	// stamp against completed_at; only the statement time keeps a correction
	// that waited for the completion, or follows it in the same transaction,
	// after it.
	"modules/studentpresence": 1,
	// Named exception on the database clock (ADR 0281): statementClock (1),
	// the clock_timestamp() of CompletionTimestamp (completed_at, read after
	// the completion's own writes), which Reopen orders against the updated_at
	// of supervisor, attendance and plan rows, and of updated_at of
	// schedule.instance_students, the plan side of that comparison. The same
	// constant ends the window of a switched-off staff notice
	// (databaseDayCutoff, ADR 0281 point 3): the trigger stamps its
	// updated_at.
	"modules/timetable": 1,
	// Store.DatabaseTime (1), the cutoffs of the staff document retentions:
	// users.delete_expired_staff_sick_notes (1.15.453) and
	// users.delete_finished_staff_document_file_cleanups (1.15.449, 1.15.606)
	// guard their cutoff with the database clock, and the column default
	// stamps created_at of a sick note on it (#7295). And the lift of a pool
	// block by the Träger (1, ADR 0281): the school lifts its blocks through
	// the database function workforce.pool_lift, which stamps lifted_at with
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
