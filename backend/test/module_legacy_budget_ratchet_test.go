package test

import (
	"bytes"
	"fmt"
	"path"
	"sort"
	"strings"
	"testing"
)

// TestModuleLegacyBudgetRatchet caps the production LOC of every legacy tree
// under backend/modules/ and backend/workflows/ at today's measured size.
//
// Why this ratchet exists: 92,928 production LOC sit in directories named
// "legacy" below backend/modules/ and backend/workflows/. They were moved
// there out of the old top-level packages, file by file, at 77-99% rename
// similarity. backend/architecture/policy.json classifies those 25 packages
// with ordinary roles (adapter 16, postgres 3, domain 2, compose 2,
// test-support 2) — "adapter" is not a debt marker. Only 56 entries in
// backend/architecture/legacy.jsonl have a legacy target at all, and they
// reach five packages holding 7,939 LOC: 84,989 of these LOC carry no exact
// tuple, so the architecture evaluator reports green and cannot point at that
// surface. No nest has shrunk since it was created, only grown:
// modules/workforce/legacy went from 15,402 to 21,468 LOC, and the merge that
// produced this seed added modules/careplan/legacy/carelifecycle (4,902 LOC)
// and modules/careplan/legacy/careexitview (382 LOC) in one step. This ratchet
// is the missing per-module completion metric.
//
// Scope: every directory named "legacy" below modules/ or workflows/,
// aggregated per TOPMOST legacy directory — a nested legacy directory inside
// a legacy tree belongs to its parent's entry and gets no entry of its own.
// Counted are the lines of every .go file in the tree except *_test.go. Keys
// are repo-relative slash paths starting at "modules/" or "workflows/".
//
// Budget semantics (the shrink-only shape the other ratchets in this package
// use, counting LOC per tree instead of hits per file):
//
//   - A tree over its budget fails. Moving code into a legacy directory is
//     not progress; never raise a number.
//   - A tree under its budget fails until the entry is lowered, so the
//     reduction cannot silently regress.
//   - A legacy tree without an entry fails: a new legacy tree is almost
//     always the wrong direction.
//   - An entry without a tree fails so the entry gets deleted — that is the
//     success case.
//
// The registers have no hand-kept total (ADR 0296): every entry is exact, so
// the measured sum equals the register sum, and
// `scripts/backend-architecture.sh check` rejects a raised register sum
// against the pull request's base. LOC shifted from one entry into another
// therefore still fails, and two pull requests that change different entries
// no longer edit one shared line.
//
// Seed: measured 2026-09-18 at merge commit ecf0003369 with a throwaway
// program (walk modules/ and workflows/ for directories named "legacy", sum
// the lines of all non-test .go files per topmost tree), run as
// `cd backend && ../scripts/run-go-toolchain.sh go run ./tmp/moduleLegacyBudget`.
// The temporary seed helper was not retained. Re-measure the current tree
// with the ratchet itself (a mismatch prints the measured values):
//
//	cd backend && ../scripts/run-go-toolchain.sh go test -tags=testhooks ./test/ \
//	  -run '^TestModuleLegacyBudgetRatchet$' -count=1 -v
//
// The first seed was taken at 19feca2822 and re-measured here after the merge
// of origin/development (a47f77b2c3): PR #3408 (issue #3350) moved the
// care-exit, companion and care-document code out of services/users into the
// new subtree modules/careplan/legacy/carelifecycle, so the numbers below are
// the merged state rather than a raised budget.
// #3427 dissolved modules/careplan/legacy entirely (5,278 LOC, the
// carelifecycle subtree and the careexitview projection) into native Care
// Plan, Timetable and the student directory projection; its entry is gone.
// #3422 dissolved the Student Presence legacy nest: first its statistics
// package (1,106 LOC) into the native application, then it handed the Care Plan
// status-day and excused-request rows (208 LOC net) to modules/careplan, and
// moved legacy/services/active (10,445 LOC) into the native presence
// application behind the public facades; the consumer switches shrank the
// grouplive, supervisiondashboard and timetable trees. The last slice folded
// legacy/repositories/active and the remaining session rows into the module's
// ports and Postgres adapter, so the tree is gone and its entry with it.
// Slice S5 of #3424 (#3551) moved the timetable reads, the operational day,
// the cleanup and the planning-track administration out of the timetable nest
// to the Timetable owner, shrinking the timetable and supervisiondashboard
// trees. Slice S2 (#3552) moved the template writes, the materialization and
// the roster maintenance after them, roughly halving the timetable tree.
// Slice S3 (#3553) moved the deviation, substitution and sick-report writes,
// the attendance correction and the attendance mirror. #3554 deleted the
// legacy SQL test providers (timetablesqltest). #3556 moved the group
// substitution relations out of the workforce tree. #3413 dissolved
// modules/workforce/legacy/timetracking (13,327 LOC) into the Workforce
// application layer and moved the work-session repository shim (1,158 LOC)
// into the Workforce composition. #3996 moved the staff absence adapters
// into the Workforce composition and trimmed the helpers the substitution
// adapter keeps (1,181 -> 763 LOC). #3487 moved the session token adapter
// (1,358 LOC) unchanged out of modules/identityaccess/legacy to
// modules/identityaccess/sessiontoken (ADR 0054); the tree and its entry are
// gone.
// Re-measure the same way when a number needs to move — downwards.
//
// Two more measurements live here since #4071 (ADR 0057 point 5), because a
// tree that is renamed instead of dissolved falls out of the per-tree budget:
//
//   - moduleLegacyFileBudgets: every non-test file named legacy_*.go anywhere
//     in the backend outside a legacy tree, keyed by its path. #3554 moved
//     the last timetable nest into modules/timetable/compose, and its
//     legacy_*.go files kept the name.
//   - moduleComposeBudgets: the production LOC of every owner composition
//     package (a directory below modules/ or workflows/ whose path has a
//     compose or composition segment, legacy trees excluded). A
//     composition constructs its owner (ADR 0053); everything else in
//     it is code that still has to move (#4084). The timetable composition
//     alone holds about 36,000 LOC.
//
// Both follow the same four outcomes and are shrink-only. A raise of any entry
// or of a register's sum against the pull request's base also fails
// `scripts/backend-architecture.sh check` (ratchet budgets); it needs an ADR
// added in the same change and cited in the comment on the raised entry, not
// on the register, so parallel raises of different entries do not collide.
const moduleLegacyBudgetCheck = "legacy LOC budget"

// moduleLegacyFileBudgetCheck and moduleComposeBudgetCheck name the two
// measurements #4071 added in failure output.
const (
	moduleLegacyFileBudgetCheck = "legacy_*.go LOC budget"
	moduleComposeBudgetCheck    = "compose LOC budget"
)

// ADR 0296 retired the hand-kept totals moduleLegacyBudgetTotal,
// moduleLegacyFileBudgetTotal and moduleComposeBudgetTotal: the register sums
// replace them.

// moduleLegacyFileBudgets maps every legacy_*.go file outside a legacy tree
// to its LOC, first measured on 2026-10-15 on top of development c49b81c3a9:
// 22 files, 3862 LOC. Carriers: the files in owner compositions #4084 (the
// timetable ones came out of the dissolved modules/timetable/legacy nest with
// #3554), api/ #4080, database/repositories/users #3990,
// modules/presenceprojection #4077 and modules/workforce/internal/planning
// #4076. No file gets a new entry, except the half of a file a move splits:
// #4084 moved the pickup exception and student status day values the roots
// name out of modules/timetable/internal/application/legacy_repository_options.go
// into modules/timetable/ports/legacy_repository_options.go. Both halves keep
// counting, and their sum stays below the old entry.
// ADR 0082: newly covered sources, measured at 722c5aa147; no headroom.
var moduleLegacyFileBudgets = map[string]int{
	"roots/owners/legacy_workforce_schedule_adapter.go": 243,
}

// moduleComposeBudgets maps every owner composition package to its production
// LOC, first measured on 2026-10-15 on top of development c49b81c3a9: 61
// packages, 90627 LOC. #4084 carries the reduction to construction only;
// modules/timetable/compose is the largest by far. Shrink-only — a new owner
// composition starts small and is no reason to raise the register sum; split
// code keeps its LOC counted. A raise cites its ADR in the comment on the
// raised entry, never here (ADR 0296): this comment is shared by every pull
// request, and `scripts/backend-architecture.sh check` reads only the entry's
// own comment. Earlier raises are recorded in their ADRs.
var moduleComposeBudgets = map[string]int{
	"modules/appointments/compose": 45,
	// ADR 0103: the signature ledger constructor, construction only.
	// ADR 0155: the signature ledger at the Träger (+8).
	// ADR 0269: the Audit clock of the persistence and the command (+7).
	"modules/auditlog/compose": 202,
	// Raised by ADR 0128: the manual plans port of the booking materialization (+1).
	// ADR 0151: the school figure constructor (+13).
	// ADR 0153: the contract offerings constructor (+9).
	// ADR 0154: the booked care offering constructor (+13).
	// #4704 (ADR 0215): the Träger offering constructors fit in shortened
	// comments (±0).
	// ADR 0225: the Stammdaten decision's class follow-up port (+3).
	// Lowered by #7104: the injected clocks fit in shortened comments (-3).
	// ADR 0241: the booking intervals of the utilization (+7).
	// ADR 0240: +8, the clock fields of its dependencies.
	// ADR 0289: +13, the seal constructor of the child health document files.
	"modules/careplan/compose":             1715, // ADR 0220: +13, the pickup change team constructor
	"modules/careplan/requestfeed/compose": 53,
	// Raised by ADR 0102: the class-trip status-day seam (#4799).
	"modules/classday/compose": 210,
	// Raised by ADR 0073: the parent announcement retention.
	// ADR 0212: the message attachments (+25).
	// ADR 0248: the parent-letter child reader constructor (+6).
	// ADR 0267: +7, the clock fields; ADR 0277: -3, message retention reads the database clock.
	"modules/communication/composition": 384,
	"modules/dataimport/compose":        85,
	// Raised by ADR 0283: the class-list conversion constructor (+2).
	"modules/dataimport/compose/imports": 31,
	// ADR 0145: +40 LOC for transport lifecycle, -8 LOC for the retired local wrapper.
	// ADR 0267: +8, the clock fields.
	"modules/delivery/compose":         387,
	"modules/delivery/objects/compose": 12, // ADR 0293
	// ADR 0268: the clock of the administration and the IoT service (+6).
	"modules/devicefleet/compose":                   209,
	"modules/devicefleet/compose/repositoryadapter": 10,
	// ADR 0124: bind the optional heartbeat to the tenant runtime savepoint (+9).
	"modules/devicescan/compose": 532,
	// Raised by ADR 0105: the holiday period constructor (+13); by ADR 0110:
	// the public holiday registration constructors (+18); by ADR 0114: the
	// holiday registration review constructor (+7); by ADR 0116: the
	// participant list constructor (+7); by ADR 0120: the holiday guest
	// constructor (+6); by ADR 0137: the holiday access trail constructor (+7).
	// #4722 shortened its comments by 7 LOC for the field cipher of
	// modules/securityruntime/compose.
	// ADR 0153: the contract applications constructor (+5).
	// ADR 0154: the booked children constructor (+6).
	// ADR 0193: the export opener of the holiday health information (+5).
	// #4703 added the holiday care wish constructor and shortened comments
	// of the package by more than it added (-2).
	// ADR 0202: the Students field of the phase administration (+2).
	// ADR 0205: the Bookings field of the phase administration (+2).
	// ADR 0207: the constructor of the announced holiday periods (+5).
	// ADR 0214: the registered children and known child trail (+10).
	// ADR 0216: account proofs and the account's holiday registrations (+10).
	// ADR 0215: NewTraegerPhases (+4) and NewOfferingSelectionReferences (+4),
	// less shortened comments and a merged file (-6).
	// ADR 0231: the registration answers constructor (+5).
	// ADR 0265: +7, the clock fields of the owner, its phases and deletions.
	"modules/enrollment/compose": 641,
	// ADR 0218: the Träger scope and the recipient rekey (+33).
	"modules/exporttransfer/compose": 180,
	// ADR 0241: the rooms of the utilization (+13).
	"modules/facilities/compose":                   192,
	"modules/facilities/compose/repositoryadapter": 10,
	// Raised by ADR 0298: the demo seed's feedback history writer and the
	// aliases of its input (+15).
	"modules/feedback/compose":         76,
	"modules/filestorage/compose":      211,
	"modules/guardianlinkview/compose": 8,
	// Raised by ADR 0106: the Träger-Büro account management (+24).
	// Raised by ADR 0187: the operator directory of the Träger export CLI (+11).
	// Raised by ADR 0261: the owner's clock, its nil default and imports (+16).
	"modules/identityaccess/compose": 1378, // raised by ADR 0077
	// ADR 0269: the clock of the participation history (+2).
	"modules/mealplan/compose": 104, // raised by ADR 0078 and ADR 0168
	// ADR 0097: the isolated tenant return constructor, no retained logic moved.
	// Raised by ADR 0112: the Träger master data constructor (+13).
	// Raised by ADR 0148: the demo school file erasure constructor (+10).
	// Raised by ADR 0152: the document template constructor (+6).
	// Raised by ADR 0157: the shared document constructors (+10).
	// Raised by ADR 0184: the operator audit of the Beleg retention (+11).
	// Raised by ADR 0187: the Träger package constructor with its PAIN.008
	// files and operator audit (+13) and the records command injected into
	// the operator provisioning (+10).
	// ADR 0198: the narrow account-retention constructor (+13).
	// Raised by ADR 0203: the data return retrieval and release constructors (+18).
	// ADR 0246: the report templates and their projection read (+5).
	// ADR 0268: the clock fields and their imports (+10).
	// ADR 0318: the constructor of the responsibilities at the schools (+5).
	"modules/organizationtenancy/compose": 384,
	// Added by ADR 0115: the Elternabrechnung's construction only.
	// Raised by ADR 0119: the billing run constructor (+7).
	// Raised by ADR 0121: the confirmation letter constructor (+8).
	// Raised by ADR 0123: the mail constructor and the mail renderer (+9).
	// Raised by ADR 0126: the document inbox constructor (+6).
	// Added by ADR 0153: construction of the care contract owner, with the
	// ports of the contract reads for the schools' access logs.
	// ADR 0156: the booked care read and the overrun evaluation (+19); #4681 lowers it by 2.
	// ADR 0155: the signature, the paper contract and the reminders (+58),
	// the test hook of the signing link (+17); ADR 0159: withdrawal and
	// termination (+35); ADR 0163: the office's decision of the parents' changes (+5);
	// ADR 0184: the contract retention of the Belege (+4).
	// ADR 0232: the import of existing contracts and its ports (+6).
	// ADR 0307 (#7760): the link of imported contracts
	// to child records and its ports (+7).
	// ADR 0309 (#7760): the plan and the binding of the enrollment of the
	// children of imported contracts and its ports (+7).
	"modules/carecontract/compose": 195,
	// Raised by ADR 0158: the monthly contribution constructor (+5);
	// ADR 0165: the constructor of the monthly letters (+7);
	// ADR 0167: the constructor of the payment terms (+5);
	// ADR 0168: the Mensa of the monthly run (+7);
	// ADR 0171: the constructor of the SEPA mandates (+5);
	// ADR 0182: the constructor of the Jahresbescheide (+7);
	// ADR 0181: the constructor of the SEPA direct debit file (+5);
	// ADR 0183: rekey constructor (+5);
	// ADR 0184: the Beleg retention constructor (+6).
	// ADR 0192: the export opener of the sealed bank data (+5).
	// ADR 0187: the PAIN.008 files of the Träger package (+7), the expiry of
	// the unsubmitted PAIN.008 downloads (+5).
	// ADR 0191: the constructor of the stored originals of the
	// Jahresbescheide (+5).
	// ADR 0218: the handovers of the finance exports (+5).
	// ADR 0232: the debtor numbers of an import of care contracts (+5).
	// ADR 0275: the time import of the root clock (+2).
	// ADR 0288: the numbers of the families from a file (+5).
	"modules/parentbilling/compose":               141,
	"modules/parentrequestfeedprojection/compose": 11,
	// Raised by ADR 0076: the restricted administrative repair constructor.
	// ADR 0188: the guardian bank backfill/rekey constructor (+6).
	// ADR 0197: the export opener of the sealed guardian bank data (+5).
	// ADR 0214: the namesakes of the known child hint (+13).
	// ADR 0234: the note search beside the facade (+2).
	// ADR 0268: the clock of the rosters, the guardians and the retention (+6).
	// ADR 0278: the time import of the guardian profile clock (+1).
	// ADR 0307 (#7760): the read of child records by
	// identifier the link of imported contracts binds (+13).
	// ADR 0327 (#8137): the names behind the Träger-Büro's list of the
	// children of its schools (+13).
	"modules/peopledirectory/compose":    1028,
	"modules/presenceprojection/compose": 7,
	"modules/requestreview/compose":      12,
	"modules/schedulerruntime/compose":   45,
	// Raised by ADR 0142: the Elternsprechtag constructor (+7) and by
	// ADR 0144: the school vacation constructor (+11).
	// ADR 0269: the default day of the real clock (+4).
	// ADR 0278: the calendar import of the notices' day clock (+1) and the
	// root's clock of the Records (+6). Raised by ADR 0298: the alias of the
	// demo seed's vacation window (+3).
	"modules/schoolcalendar/compose":        169,
	"modules/schoolcalendar/portal/compose": 112,
	// Raised by ADR 0076: the restricted administrative repair constructor.
	// ADR 0151: the school figure constructor (+6).
	// ADR 0202: the pending-window constructor (+5).
	// ADR 0268: the day clock of the store and the Kontingentzahl (+5).
	// #7295: the store's clock fits in shortened comments (-1).
	"modules/schoolmembership/compose": 204,
	// ADR 0231: the school search projection binds the school transaction.
	// ADR 0278: the calendar import of the search's day clock (+1).
	"modules/schoolsearchview/compose": 39,
	"modules/schoolsetup/compose":      56,
	// #4722: the field cipher of the health information, construction only;
	// the 7 LOC come out of modules/enrollment/compose, the total stays.
	// ADR 0183: bank cipher constructor (+6).
	"modules/securityruntime/compose": 13,
	// ADR 0154: the group names constructor (+13).
	// ADR 0268: the clock fields of the group service and the retention (+8).
	// Lowered by #7956: the retained group update moved its read-state
	// edit into the groups package (-4).
	"modules/schoolstructure/compose": 577,
	// Raised by ADR 0107 and ADR 0175: the Träger settings and school-read context guard.
	// ADR 0193: the export projection of setting values (+3).
	// ADR 0268: the clock of the operator presence-mode guard (+3).
	"modules/settings/compose":             326,
	"modules/studentdirectoryview/compose": 9,
	// Raised by ADR 0125: the dev-tools presence history constructor (+7).
	// ADR 0151: the school figure constructor (+13).
	// ADR 0156: the contract Soll port (+4).
	// ADR 0241: the presence series of the utilization (+7).
	// #2352: the session row alias the root names in the contract fits in
	// shortened comments (-1).
	// Lowered by #7808: the cross-tenant student and school aliases left
	// with the visitor read (-1, -5).
	"modules/studentpresence/compose":                 268,
	"modules/studentpresence/compose/presenceservice": 105,
	// Raised by ADR 0128: the student template days constructor (+5), by
	// ADR 0144: the vacation hint constructor (+6) and by ADR 0224: the cohort
	// rosters constructor (+5).
	// ADR 0263: the clock imports of the Timetable compositions and the clock
	// of the repository composition (+6).
	"modules/timetable/compose":                     1156,
	"modules/timetableblockdisplay/compose":         9,
	"modules/timetableenrollmentprovenance/compose": 10,
	"modules/timetableprojection/compose":           7,
	// Raised by ADR 0105: the Träger transaction binding (+4), and by
	// ADR 0185: the admin-to-tenant handoff binding (+2).
	"modules/transactionruntime/compose": 139,
	// Raised by ADR 0141: the payroll dispatch constructor (+9).
	// ADR 0151: the school figure constructor (+13).
	// ADR 0188: the bank cipher dependency and backfill/rekey constructor (+7).
	// ADR 0197: the export opener of the sealed staff bank and tax data (+5).
	// ADR 0242: the working-time check and the Einsatzplanung sites (+11).
	// ADR 0264: the clock field of the time-tracking cleanup (+2).
	// ADR 0253: the Springer exits after the last block (+6).
	// ADR 0289: the seal constructor of the sick note and payslip files (+6).
	"modules/workforce/compose":       892,
	"workflows/catererportal/compose": 31, // added by ADR 0077
	// Raised by ADR 0224: the class follow-up port (+2).
	"workflows/gradetransition/compose": 50,
	// Added by ADR 0209: the holiday allocation workflow and its joining
	// Träger transaction (ADR 0206).
	"workflows/holidayallocation/compose": 13,
	"workflows/openroommove/compose":      46,
	// Raised by ADR 0078; by ADR 0113: the prefill's data access port (+1);
	// by ADR 0126: the document inbox ports and the push of a new document
	// for the Delivery worker (+21); by ADR 0153: the contract port (+1);
	// by ADR 0157: the shared document port (+1).
	// ADR 0159: the notice port (+1).
	// ADR 0207: the port of the announced holiday periods (+1).
	// ADR 0212: the port of the message attachments (+1).
	// ADR 0216: the ports of the account's holiday registrations and of its
	// proof (+2).
	// ADR 0279: the nil default of the portal's clock (+3).
	"workflows/parentportal/compose":     339,
	"workflows/reminderdelivery/compose": 30,
	"workflows/sessionend/compose":       59,
	// ADR 0273: the day clock of the Terminvertretung (+1).
	"workflows/shiftplansync/compose":    125,
	"workflows/staffclock/compose":       36,
	"workflows/staffoffboarding/compose": 76,
	// Added by ADR 0104: construction of the Träger projection, no retained logic.
	// ADR 0246: the export adapter of the key-date report (+1).
	"modules/traegerview/compose": 21,
	// Added by ADR 0076: construction and the ambient transaction guard.
	"workflows/staffpersonmerge/compose": 31,
	// Added by ADR 0215: the Träger catalog rollout and its runtime (ADR 0195).
	"workflows/traegercatalog/compose":  38,
	"workflows/studentdeletion/compose": 74,
	// Added by ADR 0309 (#7760): the enrollment of the children of imported
	// contracts and its runtime (Träger and school transaction), no retained
	// logic.
	"workflows/contractenrollment/compose": 34,
}

// moduleLegacyBudgets maps a legacy tree to its production LOC on 2026-09-18.
// The comment on each entry names the ticket that is supposed to dissolve the
// tree; "no ticket today" is the measurement, not an omission — those trees
// have no owner and no plan, which is precisely what this ratchet exposes.
var moduleLegacyBudgets = map[string]int{}

func TestModuleLegacyBudgetRatchet(t *testing.T) {
	t.Parallel()

	backendRoot, err := findBackendRoot()
	if err != nil {
		t.Fatalf("Could not find backend root: %v", err)
		return
	}

	counts, err := moduleLegacyBudgetScan(backendRoot)
	if err != nil {
		t.Fatalf("legacy LOC scan failed: %v", err)
	}

	violations := moduleLegacyBudgetViolations(counts, moduleLegacyBudgets)

	files, err := moduleLegacyFileScan(backendRoot)
	if err != nil {
		t.Fatalf("legacy_*.go LOC scan failed: %v", err)
	}
	violations = append(violations, moduleLOCBudgetViolations(moduleLegacyFileBudgetCheck, files, moduleLegacyFileBudgets)...)

	compositions, err := moduleComposeScan(backendRoot)
	if err != nil {
		t.Fatalf("compose LOC scan failed: %v", err)
	}
	violations = append(violations, moduleLOCBudgetViolations(moduleComposeBudgetCheck, compositions, moduleComposeBudgets)...)
	if len(violations) > 0 {
		sort.Strings(violations)
		t.Errorf("Module legacy LOC budget ratchet check failed (%d issue(s)):\n\n%s",
			len(violations), strings.Join(violations, "\n\n"))
	}
}

// moduleLegacyBudgetViolations compares the measured LOC per legacy tree
// against the budgets. It does not reuse ratchetViolations because the entries
// here are LOC ceilings per directory tree rather than pattern hits per file,
// and each of the four outcomes needs its own instruction.
func moduleLegacyBudgetViolations(counts, budgets map[string]int) []string {
	var violations []string
	for tree, got := range counts {
		budget, ok := budgets[tree]
		switch {
		case !ok:
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: %d LOC, but the tree has no budget entry.\n"+
					"  A new legacy tree. That is almost always the wrong direction; if a move is genuinely necessary, add the entry with a justification.",
				moduleLegacyBudgetCheck, tree, got))
		case got > budget:
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: %d LOC, budget %d.\n"+
					"  The legacy tree grew. Moving code into a legacy directory is not progress; never raise a number.",
				moduleLegacyBudgetCheck, tree, got, budget))
		case got < budget:
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: %d LOC, budget %d.\n"+
					"  Nice — lower the budget to %d so the reduction cannot regress.",
				moduleLegacyBudgetCheck, tree, got, budget, got))
		}
	}
	for tree, budget := range budgets {
		if _, ok := counts[tree]; !ok {
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: budget %d LOC, but the tree holds no production .go file any more.\n"+
					"  Tree dissolved — remove the entry.",
				moduleLegacyBudgetCheck, tree, budget))
		}
	}
	return violations
}

// moduleLegacyBudgetScan returns the production LOC of every legacy tree,
// keyed by its repo-relative slash path. Trees holding only *_test.go files
// are omitted, so their budget entry surfaces as "dissolved, remove it".
func moduleLegacyBudgetScan(backendRoot string) (map[string]int, error) {
	files, err := goSourceIndex(backendRoot)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	for _, f := range files {
		if strings.HasSuffix(f.rel, "_test.go") {
			continue
		}
		if tree, ok := moduleLegacyBudgetRoot(f.rel); ok {
			if lines := moduleLegacyBudgetCountLines(f.content); lines > 0 {
				counts[tree] += lines
			}
		}
	}
	return counts, nil
}

// moduleLegacyBudgetRoot returns the topmost directory named "legacy" above
// rel below modules/ and workflows/. A hidden directory above it hides the
// tree, so a legacy directory nested inside a legacy tree is counted with its
// parent instead of forming a second entry.
func moduleLegacyBudgetRoot(rel string) (string, bool) {
	parts := strings.Split(rel, "/")
	if parts[0] != "modules" && parts[0] != "workflows" {
		return "", false
	}
	for index := 1; index < len(parts)-1; index++ {
		switch {
		case strings.HasPrefix(parts[index], "."):
			return "", false
		case parts[index] == "legacy":
			return strings.Join(parts[:index+1], "/"), true
		}
	}
	return "", false
}

// moduleLegacyBudgetCountLines counts lines, not statements: the budget
// measures how much code still has to move out, and a comment-heavy file is
// no cheaper to migrate.
func moduleLegacyBudgetCountLines(content []byte) int {
	lines := bytes.Count(content, []byte("\n"))
	if len(content) > 0 && content[len(content)-1] != '\n' {
		lines++
	}
	return lines
}

// moduleLOCBudgetViolations compares measured LOC per key with a register of
// the two #4071 measurements, with the four outcomes of the legacy trees.
func moduleLOCBudgetViolations(check string, counts, budgets map[string]int) []string {
	var violations []string
	for key, got := range counts {
		budget, ok := budgets[key]
		switch {
		case !ok:
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: %d LOC, but it has no budget entry.\n"+
					"  Code moved here from a counted place keeps counting; a new entry needs a justification and the register sum may not rise.",
				check, key, got))
		case got > budget:
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: %d LOC, budget %d.\n"+
					"  It grew. Never raise a number; a raise needs an ADR (ADR 0057 point 5).",
				check, key, got, budget))
		case got < budget:
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: %d LOC, budget %d.\n"+
					"  Nice — lower the budget to %d so the reduction cannot regress.",
				check, key, got, budget, got))
		}
	}
	for key, budget := range budgets {
		if _, ok := counts[key]; !ok {
			violations = append(violations, fmt.Sprintf(
				"[%s] %s: budget %d LOC, but it holds no production .go code any more.\n"+
					"  Remove the entry.",
				check, key, budget))
		}
	}
	return violations
}

// moduleLegacyFileScan returns the LOC of every non-test legacy_*.go file in
// the backend outside a directory named legacy, keyed by its backend-relative
// path. Test helpers (legacy_*_test_helpers.go) compile into production and
// count.
func moduleLegacyFileScan(backendRoot string) (map[string]int, error) {
	files, err := goSourceIndex(backendRoot)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, f := range files {
		name := path.Base(f.rel)
		if !strings.HasPrefix(name, "legacy_") || strings.HasSuffix(name, "_test.go") ||
			inDirNamed(f.rel, "legacy", "testdata", "vendor", "node_modules") {
			continue
		}
		counts[f.rel] = moduleLegacyBudgetCountLines(f.content)
	}
	return counts, nil
}

// moduleComposeScan returns the production LOC of every owner composition
// package below modules/ and workflows/, keyed by its directory. A package is a
// composition when a path segment below the module directory is compose or
// composition; legacy trees are counted by moduleLegacyBudgets instead.
func moduleComposeScan(backendRoot string) (map[string]int, error) {
	files, err := goSourceIndex(backendRoot)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, f := range files {
		if !strings.HasPrefix(f.rel, "modules/") && !strings.HasPrefix(f.rel, "workflows/") ||
			strings.HasSuffix(f.rel, "_test.go") || inDirNamed(f.rel, "legacy", "testdata") ||
			!moduleComposePackage(f.pkg) {
			continue
		}
		counts[f.pkg] += moduleLegacyBudgetCountLines(f.content)
	}
	return counts, nil
}

func moduleComposePackage(dir string) bool {
	parts := strings.Split(dir, "/")
	for index, part := range parts {
		if index >= 2 && (part == "compose" || part == "composition") {
			return true
		}
	}
	return false
}
