package test

import (
	"fmt"
	"sort"
)

// calendarFixtureShiftedLiveDateDebt freezes the findings of one category of
// TestCalendarFixtureClockRatchet: a live date or instant shifted by whole
// days that reaches the code under test (#4027 gaps a and d; the 14.10.2026
// case cc0e9a36e9, SubmitPickupChangeRequest with TodayDate().AddDays(3) on a
// weekend). Keyed by backend-relative test file, valued by the number of such
// findings the file had when the category was added. The other categories
// have no baseline; they fail on every finding.
//
// Seed on 2026-11-14 (parent development 08ff7ba887): 588 findings in 130
// files, measured with
//
//	cd backend && ../scripts/run-go-toolchain.sh go test -tags=testhooks ./test -run '^TestCalendarFixtureClockRatchet$' -count=1
//
// after the reviewed calendarFixtureClockExceptions. #7104 burns
// the register down: pin the dates or inject a clock (Rule 14), then lower or
// delete the entry.
//
// Shrink-only (Rule 16; scripts/backend-architecture.sh check compares every
// value and the sum against the pull request's base):
//
//   - A file with more findings than its entry fails, and so does a file
//     without an entry on its first finding: a new shifted live date fails
//     immediately.
//   - A file with fewer findings than its entry fails until the entry is
//     lowered, so a repair cannot silently regress.
//   - An entry whose file has no finding left fails so the entry is deleted.
//   - A raised entry or a new key fails the architecture check against the
//     base; never raise a number and never add a key.
var calendarFixtureShiftedLiveDateDebt = map[string]int{
	"api/data_return_http_test.go":                                                               1,
	"api/runtime_checkpoint_test.go":                                                             9,
	"api/runtime_checkpoint_v2_test.go":                                                          3,
	"cmd/cleanup_test.go":                                                                        6,
	"cmd/devtools/demo_runtime_test.go":                                                          2,
	"cmd/tenant_erasure_integration_test.go":                                                     2,
	"modules/organizationtenancy/compose/data_return_export_test.go":                             1,
	"modules/organizationtenancy/internal/adapters/datareturn/datareturn_test.go":                3,
	"modules/parentrequestfeedprojection/internal/adapters/postgres/query_budget_growth_test.go": 1,
	"modules/parentrequestfeedprojection/internal/adapters/postgres/query_test.go":               1,
	"modules/peopledirectory/contracttest/staff_offboarding_test.go":                             6,
	"workflows/parentportal/care_exception_auto_excusal_test.go":                                 8,
	"workflows/parentportal/excused_request_error_test.go":                                       3,
	"workflows/parentportal/excused_request_test.go":                                             10,
	"workflows/parentportal/http/behaviortest/child_write_handlers_test.go":                      10,
	"workflows/parentportal/http/behaviortest/pickup_change_cutoff_handlers_test.go":             1,
	"workflows/parentportal/http/behaviortest/request_edit_handlers_test.go":                     1,
	"workflows/parentportal/internal/care/behaviortest/parent_declaration_test.go":               1,
	"workflows/parentportal/internal/care/parent_care_offerings_service_test.go":                 2,
	"workflows/parentportal/parent_care_exception_emit_test.go":                                  3,
	"workflows/parentportal/parent_pickup_change_service_test.go":                                12,
	"workflows/parentportal/parent_request_edit_test.go":                                         10,
	"workflows/parentportal/parent_request_ledger_test.go":                                       2,
	"workflows/parentportal/parent_request_reason_enforcement_test.go":                           3,
	"workflows/parentportal/parent_request_share_at_creation_test.go":                            3,
	"workflows/parentportal/parent_write_service_test.go":                                        4,
	"workflows/shiftplansync/compose/behaviortest/sick_cascade_test.go":                          18,
	"workflows/shiftplansync/compose/behaviortest/substitution_test.go":                          20,
	"workflows/studentdeletion/behaviortest/student_deletion_workflow_test.go":                   1,
	"workflows/studentdeletion/http/graduate_purge_audit_test.go":                                1,
}

// applyCalendarShiftDebt removes the shifted-live-date findings that a
// file's debt entry still covers and reports every entry that no longer
// matches its file.
func applyCalendarShiftDebt(findings []calendarClockFinding, debt map[string]int) ([]calendarClockFinding, []string) {
	counts := map[string]int{}
	for _, finding := range findings {
		if finding.risk == calendarShiftRisk {
			counts[finding.file]++
		}
	}
	var problems []string
	for file, count := range counts {
		switch allowed := debt[file]; {
		case count > allowed:
			problems = append(problems, fmt.Sprintf("%s: %d shifted-live-date finding(s), debt entry %d; fix the new ones, never raise the entry", file, count, allowed))
		case count < allowed:
			problems = append(problems, fmt.Sprintf("%s: %d shifted-live-date finding(s), debt entry %d; lower the entry to %d", file, count, allowed, count))
		}
	}
	for file, allowed := range debt {
		if counts[file] == 0 {
			problems = append(problems, fmt.Sprintf("%s: debt entry %d has no finding left; delete the entry", file, allowed))
		}
	}
	sort.Strings(problems)
	kept := make([]calendarClockFinding, 0, len(findings))
	for _, finding := range findings {
		if finding.risk != calendarShiftRisk || counts[finding.file] > debt[finding.file] {
			kept = append(kept, finding)
		}
	}
	return kept, problems
}
