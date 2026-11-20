package architecture

import (
	"slices"
	"strings"
	"testing"
)

func TestSeedHistoryWritersRulesRequireReviewedEpoch(t *testing.T) {
	t.Parallel()
	candidate := repositoryPolicy(t)
	base := *candidate
	base.PolicyEpoch--
	base.Rules = slices.DeleteFunc(slices.Clone(candidate.Rules), reviewedSeedHistoryWritersRule)
	if len(candidate.Rules)-len(base.Rules) != len(seedHistoryWriterPackages) {
		t.Fatalf("expected one reviewed rule per seed writer composition, got %d", len(candidate.Rules)-len(base.Rules))
	}
	if err := comparePolicyStrictness(&base, candidate, noCreated(), noCreated(), noCreated(), noCreated(), nil); err != nil {
		t.Fatalf("reviewed seed writer rules: %v", err)
	}
	unreviewed := *candidate
	unreviewed.PolicyEpoch = base.PolicyEpoch
	if err := comparePolicyStrictness(&base, &unreviewed, noCreated(), noCreated(), noCreated(), noCreated(), nil); err == nil {
		t.Fatal("the seed writer rules passed without an epoch")
	}
}

func TestSeedHistoryWritersRuleRejectsBroadenedSelectors(t *testing.T) {
	t.Parallel()
	original := Rule{SourceOwner: "dev-tools", SourceRole: "compose", TargetPackage: "modules/feedback/compose",
		TargetOwner: "feedback", TargetRole: "compose", Scopes: []string{"production"}}
	if !reviewedSeedHistoryWritersRule(original) {
		t.Fatal("the reviewed rule itself must be accepted")
	}
	for name, mutate := range map[string]func(*Rule){
		"any source owner":          func(r *Rule) { r.SourceOwner = "" },
		"another source":            func(r *Rule) { r.SourceOwner = "organization-tenancy" },
		"source kind":               func(r *Rule) { r.SourceOwnerKind = "tool" },
		"source package":            func(r *Rule) { r.SourcePackage = "cmd/devtools" },
		"another source role":       func(r *Rule) { r.SourceRole = "cli" },
		"every composition package": func(r *Rule) { r.TargetPackage = "" },
		"another package":           func(r *Rule) { r.TargetPackage = "modules/feedback/internal/adapters/postgres" },
		"a foreign composition":     func(r *Rule) { r.TargetPackage = "modules/schoolcalendar/compose" },
		"an unlisted owner":         func(r *Rule) { r.TargetOwner = "care-plan" },
		"owner kind":                func(r *Rule) { r.TargetOwnerKind = "platform" },
		"another role":              func(r *Rule) { r.TargetRole = "application" },
		"external class":            func(r *Rule) { r.TargetClass = "orm-sql" },
		"same owner":                func(r *Rule) { r.SameOwner = true },
		"test scope":                func(r *Rule) { r.Scopes = []string{"production", "internal_test"} },
		"only a test scope":         func(r *Rule) { r.Scopes = []string{"external_test"} },
	} {
		broadened := original
		broadened.Scopes = slices.Clone(original.Scopes)
		mutate(&broadened)
		if reviewedSeedHistoryWritersRule(broadened) {
			t.Errorf("%s: broadened rule accepted", name)
		}
	}
}

func TestSeedHistoryWritersEpochGrantsNoOtherPackage(t *testing.T) {
	t.Parallel()
	candidate := repositoryPolicy(t)
	base := *candidate
	base.PolicyEpoch--
	base.Rules = slices.DeleteFunc(slices.Clone(candidate.Rules), reviewedSeedHistoryWritersRule)
	widened := *candidate
	rule := Rule{ID: "dev-tools.compose.feedback-public", Description: "test", SourceOwner: "dev-tools", SourceRole: "compose",
		TargetOwner: "feedback", TargetRole: "public", Scopes: []string{"production"}}
	widened.Rules = append(slices.Clone(candidate.Rules), rule)
	err := comparePolicyStrictness(&base, &widened, noCreated(), noCreated(), noCreated(), noCreated(), nil)
	if err == nil || !strings.Contains(err.Error(), rule.ID) {
		t.Fatalf("the Feedback public role escaped the guard: %v", err)
	}
}
