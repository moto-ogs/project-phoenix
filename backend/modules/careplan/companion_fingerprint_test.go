package careplan_test

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

// Moved from People Directory's departure package, which kept a second
// copy of the function (#7904).
// TestCompanionLinksFingerprint_OrderIndependent pins that the fingerprint
// describes the SET of links: a re-fetch handing the same links back in another
// order (or with the weekdays shuffled) must not read as a foreign change and
// refuse a legitimate save.
func TestCompanionLinksFingerprint_OrderIndependent(t *testing.T) {
	t.Parallel()

	a := []careplan.CompanionLink{
		{CompanionStudentID: 42, Weekdays: []string{"mon", "wed"}},
		{CompanionStudentID: 7, Weekdays: []string{"fri"}},
	}
	b := []careplan.CompanionLink{
		{CompanionStudentID: 7, Weekdays: []string{"fri"}},
		{CompanionStudentID: 42, Weekdays: []string{"wed", "mon"}},
	}

	if got, want := careplan.CompanionLinksFingerprint(a), careplan.CompanionLinksFingerprint(b); got != want {
		t.Errorf("fingerprint = %q, want %q", got, want)
	}
}

// TestCompanionLinksFingerprint_DetectsChange pins the case the check exists
// for: a link someone else added must not fingerprint like the list without it.
func TestCompanionLinksFingerprint_DetectsChange(t *testing.T) {
	t.Parallel()

	loaded := []careplan.CompanionLink{{CompanionStudentID: 7, Weekdays: []string{"fri"}}}
	stored := []careplan.CompanionLink{
		{CompanionStudentID: 7, Weekdays: []string{"fri"}},
		{CompanionStudentID: 9, Weekdays: []string{"fri"}},
	}

	if careplan.CompanionLinksFingerprint(loaded) == careplan.CompanionLinksFingerprint(stored) {
		t.Error("an added link must change the fingerprint")
	}
	// A weekday added to an EXISTING link counts as a change too.
	widened := []careplan.CompanionLink{{CompanionStudentID: 7, Weekdays: []string{"thu", "fri"}}}
	if careplan.CompanionLinksFingerprint(loaded) == careplan.CompanionLinksFingerprint(widened) {
		t.Error("an added weekday must change the fingerprint")
	}
}
