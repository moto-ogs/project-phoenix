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
	// Named exception (#7104, ADR 0274), the opt-in runtime checkpoint
	// (docs/runtime-checkpoints): measureRuntimeCheckpoint and
	// newTargetRiskWorkload time the complete production Serve graph that
	// WithRuntime builds, which keeps the real clock by design
	// (newProductionEnvironment) and has no clock input. Its enrollment
	// service window and care-end days must lie around that real day.
	// Pinning them would need a clock on the production ServeConfig only
	// for this measurement; it runs in no CI job.
	"api/runtime_checkpoint_test.go":    9,
	"api/runtime_checkpoint_v2_test.go": 3,
	// Named exception (#7104, ADR 0274), the data return: the release
	// runs as phoenix_data_return, which holds no table right, only EXECUTE
	// on the SECURITY DEFINER functions of migrations 1.15.917/1.15.919.
	// platform.data_return_issue bounds keep_until (up to 366 days) and the
	// token lifetime (up to 30 days) against PostgreSQL's now(); revoke,
	// purge and issued_at stamp now() as well. The database clock is the
	// security boundary of the release: an instant passed in by the caller
	// would let the role choose its own "now" and void both bounds. The
	// tests therefore place keep_until relative to the real day the
	// database decides on. The root and composition tests read that day
	// through testpkg.DatabaseNow (#7295) and left this register.
	"modules/organizationtenancy/internal/adapters/datareturn/datareturn_test.go": 3,
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
