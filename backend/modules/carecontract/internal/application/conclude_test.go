package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// concludeStore records the writes of the transition; every other method of
// the store stays unused.
type concludeStore struct {
	Store
	concluded []carecontract.Concluded
	events    []Event
}

func (s *concludeStore) MarkConcluded(_ context.Context, _, _, _ int64, conclusion carecontract.Concluded) error {
	s.concluded = append(s.concluded, conclusion)
	return nil
}

func (s *concludeStore) InsertEvents(_ context.Context, _ int64, events []Event) error {
	s.events = append(s.events, events...)
	return nil
}

func sentRecord() ContractRecord {
	document := int64(31)
	return ContractRecord{
		Summary:    carecontract.ContractSummary{ID: 7, SchoolID: 3, Status: carecontract.StatusSent},
		Version:    carecontract.Version{ID: 11, Status: carecontract.VersionRequested},
		DocumentID: &document,
	}
}

// TestConcludeContractOnlyConcludesASentContractOnce pins the invariants of
// the one transition both ways share (#4680, #4679).
func TestConcludeContractOnlyConcludesASentContractOnce(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	conclusion := carecontract.Concluded{Method: carecontract.MethodWithApplication, At: at}

	refused := map[string]func(*ContractRecord){
		"draft":             func(r *ContractRecord) { r.Summary.Status = carecontract.StatusDraft },
		"active":            func(r *ContractRecord) { r.Summary.Status = carecontract.StatusActive },
		"ended":             func(r *ContractRecord) { r.Summary.Status = carecontract.StatusEnded },
		"no frozen PDF":     func(r *ContractRecord) { r.DocumentID = nil },
		"effective version": func(r *ContractRecord) { r.Version.Status = carecontract.VersionEffective },
	}
	for name, change := range refused {
		record := sentRecord()
		change(&record)
		store := &concludeStore{}
		err := concludeContract(context.Background(), store, 1, 0, record, conclusion)
		require.ErrorIs(t, err, carecontract.ErrContractNotConcludable, name)
		assert.Empty(t, store.concluded, "%s: nothing is written", name)
		assert.Empty(t, store.events, "%s: nothing lands in the trail", name)
	}

	store := &concludeStore{}
	require.Error(t, concludeContract(context.Background(), store, 1, 0, sentRecord(),
		carecontract.Concluded{Method: "handschlag", At: at}), "an unknown method is refused")
	require.Error(t, concludeContract(context.Background(), store, 1, 0, sentRecord(),
		carecontract.Concluded{Method: carecontract.MethodPaper}), "a conclusion needs its instant")
	assert.Empty(t, store.concluded)

	require.NoError(t, concludeContract(context.Background(), store, 1, 42, sentRecord(), conclusion))
	assert.Equal(t, []carecontract.Concluded{conclusion}, store.concluded)
	require.Len(t, store.events, 1)
	assert.Equal(t, ActionConclude, store.events[0].Action)
	assert.Equal(t, int64(42), store.events[0].AccountID)
	assert.Equal(t, map[string]any{"method": carecontract.MethodWithApplication, "version_id": int64(11), "document_id": int64(31)},
		store.events[0].Details)
}

// TestAcceptanceIssueNeedsTickedConditionsShownBeforeTheAcceptance pins the
// proof of Weg b (ADR 0088 section 3): a ticked conditions block with its
// checksum, submitted before the school's acceptance, with conditions that
// did not change after the submission.
func TestAcceptanceIssueNeedsTickedConditionsShownBeforeTheAcceptance(t *testing.T) {
	t.Parallel()
	submitted := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	accepted := submitted.Add(24 * time.Hour)
	terms := carecontract.TemplateInput{TermKind: carecontract.TermOpenEnded, NoticeMonths: 1,
		NoticeTo: carecontract.NoticeMonthEnd, ContractPartner: "Träger"}
	proof := carecontract.AcceptedText{Key: "terms", Text: acceptanceText(terms), SHA256: "abc", SubmittedAt: submitted, Required: true}
	draft := func(at *time.Time, proofs ...carecontract.AcceptedText) NewContract {
		return NewContract{AcceptedAt: at, Acceptances: proofs, Version: carecontract.Version{Terms: terms}}
	}
	before := submitted.Add(-time.Hour)

	assert.Empty(t, acceptanceIssue(draft(&accepted, proof), legacyHistory(before)), "proof before the acceptance, conditions older")
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(&accepted), legacyHistory(before)), "approval alone is no proof")
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(nil, proof), legacyHistory(before)), "no acceptance instant")
	unsigned := proof
	unsigned.SHA256 = ""
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(&accepted, unsigned), legacyHistory(before)), "no checksum of the shown text")
	optional := proof
	optional.Required = false
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(&accepted, optional), legacyHistory(before)),
		"an optional block the parents ticked is no proof of the conditions (#4682)")
	late := proof
	late.SubmittedAt = accepted.Add(time.Minute)
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(&accepted, late), legacyHistory(before)), "a submission after the acceptance")
	unrelated := proof
	unrelated.Text = "Ich stimme der Schulordnung zu."
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(&accepted, unrelated), legacyHistory(before)),
		"a checked terms block must cover the actual contract conditions")
	assert.Empty(t, acceptanceIssue(draft(&accepted, proof), legacyHistory(submitted.Add(time.Minute))),
		"saving identical conditions does not invalidate consent")
	changed := draft(&accepted, proof)
	changed.Version.Terms.NoticeMonths++
	assert.Equal(t, carecontract.SkipAcceptanceChanged, acceptanceIssue(changed, legacyHistory(submitted.Add(time.Minute))),
		"different conditions after the submission")
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(changed, legacyHistory(before)),
		"a pre-existing template does not prove consent to its different conditions")
	unrelated.SubmittedAt = submitted.Add(time.Minute)
	matched, ok := acceptanceProof(draft(&accepted, proof, unrelated))
	require.True(t, ok)
	assert.Equal(t, proof, matched, "the trail must record the matching block, not a later unrelated one")
}

// legacyHistory is a template saved before the trail recorded its versions:
// only the change of its row is known.
func legacyHistory(changedAt time.Time) templateHistory {
	return templateHistory{updatedAt: changedAt}
}

// recordedHistory is a template whose every save recorded the conditions
// texts of its version, changed at changedAt on the database clock.
func recordedHistory(changedAt time.Time, versions ...carecontract.TemplateInput) templateHistory {
	history := templateHistory{updatedAt: changedAt, complete: true}
	for _, terms := range versions {
		details := versionDetails(1, 1, terms)
		history.versions = append(history.versions, details[VersionsDetail].([]string)...)
	}
	return history
}

// TestAcceptanceIssueComparesTheTickedTextWithTheSavedVersions pins the
// decision between changed and missing conditions without ordering two
// clocks (#7295, ADR 0281): Enrollment stamps the parents' submission on its
// clock, the database the template row. Whether the database stamp lies a
// month before or after the submission, a ticked text of a saved earlier
// version is a change, an untouched template proves the consent, and a text
// that was never a version of the template is no proof.
func TestAcceptanceIssueComparesTheTickedTextWithTheSavedVersions(t *testing.T) {
	t.Parallel()
	submitted := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	accepted := submitted.Add(24 * time.Hour)
	ticked := carecontract.TemplateInput{TermKind: carecontract.TermOpenEnded, NoticeMonths: 1,
		NoticeTo: carecontract.NoticeMonthEnd, ContractPartner: "Träger"}
	current := ticked
	current.NoticeMonths = 3
	other := ticked
	other.ContractPartner = "Anderer Träger"
	proof := carecontract.AcceptedText{Key: "terms", Text: acceptanceText(ticked), SHA256: "abc", SubmittedAt: submitted, Required: true}
	draft := func(terms carecontract.TemplateInput) NewContract {
		return NewContract{AcceptedAt: &accepted, Acceptances: []carecontract.AcceptedText{proof}, Version: carecontract.Version{Terms: terms}}
	}
	for _, shift := range []time.Duration{-31 * 24 * time.Hour, 31 * 24 * time.Hour} {
		changedAt := submitted.Add(shift)
		assert.Equal(t, carecontract.SkipAcceptanceChanged, acceptanceIssue(draft(current), recordedHistory(changedAt, ticked, current)),
			"the parents ticked a saved version the template no longer has (database clock %v from the submission)", shift)
		assert.Empty(t, acceptanceIssue(draft(ticked), recordedHistory(changedAt, ticked)),
			"the untouched template proves the consent (database clock %v from the submission)", shift)
		assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(current), recordedHistory(changedAt, other, current)),
			"a text that was never a version of the template is no proof (database clock %v from the submission)", shift)
	}
	assert.Equal(t, carecontract.SkipAcceptanceChanged, acceptanceIssue(draft(current), templateHistory{updatedAt: submitted.Add(-time.Hour),
		versions: recordedHistory(submitted, ticked).versions}),
		"a recorded version counts in an incomplete history as well")
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(current), legacyHistory(submitted.Add(-time.Hour))),
		"an incomplete history keeps the earlier guard on the template row")
	assert.Equal(t, carecontract.SkipAcceptanceMissing, acceptanceIssue(draft(current), legacyHistory(submitted)),
		"the old guard requires a template write strictly after the submission")
	assert.Equal(t, carecontract.SkipAcceptanceChanged, acceptanceIssue(draft(current), legacyHistory(submitted.Add(time.Hour))),
		"an incomplete history keeps the earlier guard on the template row")
}

func TestTemplateHistoryIsCompleteOnlyForEveryOffering(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	changes := templateChanges{
		{1, 10}: {updatedAt: at, versions: []string{"a"}, complete: true},
		{1, 11}: {updatedAt: at.Add(time.Hour), versions: []string{"b"}},
		{1, 12}: {updatedAt: at, versions: []string{"c"}, complete: true},
	}
	joined := changes.since(1, []int64{10, 11})
	assert.False(t, joined.complete, "one offering without a recorded history")
	assert.Equal(t, at.Add(time.Hour), joined.updatedAt)
	assert.ElementsMatch(t, []string{"a", "b"}, joined.versions)
	assert.True(t, changes.since(1, []int64{10, 12}).complete)
	assert.False(t, changes.since(1, []int64{10, 13}).complete, "an offering without template")
	assert.False(t, changes.since(1, nil).complete)
}

func TestAcceptanceTextBindsEveryTemplateCondition(t *testing.T) {
	t.Parallel()
	months := 12
	terms := carecontract.TemplateInput{
		TermKind: carecontract.TermFixedMonths, TermMonths: &months, NoticeMonths: 1,
		NoticeTo: carecontract.NoticeMonthEnd, ContractPartner: "Träger",
		SpecialTermination: true, SpecialTerminationNote: "Bei Umzug",
		StatuteRequired: true, StatuteTitle: "Beitragsordnung", StatuteURL: "https://example.org/satzung",
	}
	text := acceptanceText(terms)
	assert.Equal(t, "Vertragsbedingungen für die Betreuung\n\nLaufzeit:\n  12 Monate\n\nKündigung:\n  mit 1 Monat Frist zum Monatsende\n\nVertragspartner:\n  Träger\n\nSonderkündigung:\n  Ja, mit 1 Monat Frist zum Halbjahr (31. Januar oder 31. Juli)\n  Bei Umzug\n\nSatzung:\n  Ja\n  Beitragsordnung\n\nLink zur Satzung:\n  https://example.org/satzung", text)
	changes := map[string]func(*carecontract.TemplateInput){
		"term kind":           func(v *carecontract.TemplateInput) { v.TermKind = carecontract.TermSchoolYear },
		"term months":         func(v *carecontract.TemplateInput) { n := 11; v.TermMonths = &n },
		"notice months":       func(v *carecontract.TemplateInput) { v.NoticeMonths++ },
		"notice to":           func(v *carecontract.TemplateInput) { v.NoticeTo = carecontract.NoticeHalfYear },
		"partner":             func(v *carecontract.TemplateInput) { v.ContractPartner = "Anderer Träger" },
		"special termination": func(v *carecontract.TemplateInput) { v.SpecialTermination = false },
		"special note":        func(v *carecontract.TemplateInput) { v.SpecialTerminationNote += " oder Schulwechsel" },
		"statute required":    func(v *carecontract.TemplateInput) { v.StatuteRequired = false },
		"statute title":       func(v *carecontract.TemplateInput) { v.StatuteTitle += " Neu" },
		"statute URL":         func(v *carecontract.TemplateInput) { v.StatuteURL += "/neu" },
	}
	for name, change := range changes {
		changed := terms
		change(&changed)
		assert.NotEqual(t, text, acceptanceText(changed), name)
	}
	terms.ContractPartner = ""
	assert.Empty(t, acceptanceText(terms), "the letterhead fallback is not part of the accepted conditions")
}

func TestManualDraftKeepsEarlyStartConsent(t *testing.T) {
	t.Parallel()
	accepted := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	read := schoolRead{school: carecontract.School{ID: 7},
		offerings: map[int64]carecontract.Offering{3: {ID: 3, Name: "Ganztag"}},
		applications: []carecontract.Application{{RequestChildID: 9, AcceptedAt: &accepted,
			Bookings:    []carecontract.Booking{{CareOfferingID: 3, Days: []string{"mon"}}},
			Acceptances: []carecontract.AcceptedText{{Text: EarlyStartText, SHA256: "proof", SubmittedAt: accepted.Add(-time.Hour)}},
		}},
	}
	draft, reason := (&Intake{}).draft(carecontract.CandidateKey{SchoolID: 7, RequestChildID: 9}, []schoolRead{read},
		templateIndex{{7, 3}: {TermKind: carecontract.TermOpenEnded, NoticeTo: carecontract.NoticeMonthEnd}},
		map[ContractKey]bool{}, calendar.NewDate(2026, 11, 6))
	require.Empty(t, reason)
	assert.True(t, draft.EarlyStart, "manual drafts retain the parents' voluntary consent")
	assert.Contains(t, withdrawalBlocks(ContractRecord{EarlyStart: draft.EarlyStart}, withdrawalContact{Partner: "Träger"})[1].Text, "ausdrücklich verlangt")
}
