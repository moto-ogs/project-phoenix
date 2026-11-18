package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestCarriedFamilyCountKeepsTheLatestParentStatement(t *testing.T) {
	t.Parallel()
	today, from := calendar.NewDate(2027, 1, 10), calendar.NewDate(2027, 1, 1)
	confirmedAt := from.BerlinMidnight()
	statedAt := confirmedAt.Add(24 * time.Hour)
	counts := []parentbilling.FamilyChildCount{
		{ID: 1, ContractID: 1, FamilyEmail: "contract:1", ConfirmedChildren: ptr(3), ValidFrom: &from, ConfirmedAt: &confirmedAt},
		{ID: 2, ContractID: 2, FamilyEmail: "family@example.org", StatedChildren: ptr(4), StatedAt: &statedAt},
	}
	recipients := map[int64]parentbilling.CareRecipient{1: {Email: "family@example.org"}, 2: {Email: "family@example.org"}}
	for _, ordered := range [][]parentbilling.FamilyChildCount{counts, {counts[1], counts[0]}} {
		families := groupFamilies(nil, recipients, ordered, today)
		require.Len(t, families, 1)
		assert.Equal(t, parentbilling.FamilyChildrenChanged, families[0].Status)
		require.NotNil(t, families[0].Count)
		assert.Equal(t, ptr(3), families[0].Count.ConfirmedChildren)
		assert.Equal(t, ptr(4), families[0].Count.StatedChildren)
		assert.Equal(t, &statedAt, families[0].Count.StatedAt)
	}
	assert.Nil(t, counts[0].StatedChildren, "combining the response does not mutate a stored source")
	newer := statedAt.Add(time.Hour)
	counts[0].StatedChildren, counts[0].StatedAt = ptr(5), &newer
	families := groupFamilies(nil, recipients, counts, today)
	assert.Equal(t, ptr(5), families[0].Count.StatedChildren, "the newest statement wins across every source")
}

func TestEqualCarriedFamilyCountsShowTheCurrentValidity(t *testing.T) {
	t.Parallel()
	today, from, until, future := calendar.NewDate(2027, 1, 10), calendar.NewDate(2027, 1, 1), calendar.NewDate(2027, 6, 30), calendar.NewDate(2028, 1, 1)
	counts := []parentbilling.FamilyChildCount{
		{ID: 1, ContractID: 1, FamilyEmail: "contract:1", ConfirmedChildren: ptr(3), ValidFrom: &from, ValidUntil: &until},
		{ID: 2, ContractID: 2, FamilyEmail: "contract:2", ConfirmedChildren: ptr(3), ValidFrom: &future},
	}
	recipients := map[int64]parentbilling.CareRecipient{1: {Email: "family@example.org"}, 2: {Email: "family@example.org"}}
	for _, ordered := range [][]parentbilling.FamilyChildCount{counts, {counts[1], counts[0]}} {
		families := groupFamilies(nil, recipients, ordered, today)
		require.Len(t, families, 1)
		assert.Equal(t, parentbilling.FamilyChildrenConfirmed, families[0].Status)
		require.NotNil(t, families[0].Count)
		assert.Equal(t, &from, families[0].Count.ValidFrom)
		assert.Equal(t, &until, families[0].Count.ValidUntil)
		families = groupFamilies(nil, recipients, ordered, until.AddDays(-10))
		assert.Equal(t, parentbilling.FamilyChildrenExpiring, families[0].Status)
		families = groupFamilies(nil, recipients, ordered, until.AddDays(1))
		assert.Equal(t, parentbilling.FamilyChildrenExpired, families[0].Status, "a distant future confirmation does not cover the gap")
		families = groupFamilies(nil, recipients, ordered, future)
		assert.Equal(t, parentbilling.FamilyChildrenConfirmed, families[0].Status)
	}
	counts[1].ValidFrom = ptr(until.AddDays(1))
	families := groupFamilies(nil, recipients, counts, until.AddDays(-10))
	assert.Equal(t, parentbilling.FamilyChildrenConfirmed, families[0].Status, "an adjacent equal confirmation extends coverage")
	assert.Nil(t, families[0].Count.ValidUntil)
}

func TestBroughtFamilyNumbersKeepTheLongestConfirmation(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2027, 1, 10)
	from, expired, later := calendar.NewDate(2026, 9, 1), calendar.NewDate(2026, 12, 31), calendar.NewDate(2027, 6, 30)
	counts := []parentbilling.FamilyChildCount{
		{ID: 1, ContractID: 1, FamilyEmail: "contract:1", ConfirmedChildren: ptr(3), ValidFrom: &from, ValidUntil: &expired},
		{ID: 2, ContractID: 2, FamilyEmail: "contract:2", ConfirmedChildren: ptr(3), ValidFrom: &from, ValidUntil: &later},
	}
	recipients := map[int64]parentbilling.CareRecipient{1: {Email: "family@example.org"}, 2: {Email: "family@example.org"}}
	for _, ordered := range [][]parentbilling.FamilyChildCount{counts, {counts[1], counts[0]}} {
		families := groupFamilies(nil, recipients, ordered, today)
		require.Len(t, families, 1)
		assert.Equal(t, parentbilling.FamilyChildrenConfirmed, families[0].Status)
		require.NotNil(t, families[0].Count)
		assert.Equal(t, counts[1].ID, families[0].Count.ID)

		numbers, _ := numbersByFamily(ordered, recipients)
		rows := []familyImportCandidate{{targets: []familyImportTarget{{family: "family@example.org", contractID: 2, firstDay: from}},
			row: parentbilling.FamilyChildrenImportRow{Children: ptr(2)}}}
		decideFamilyImport(rows, numbers, today)
		assert.Equal(t, parentbilling.FamilyImportDiffers, rows[0].row.Status, "an expired source cannot permit replacing the valid number")
	}
	numbers, _ := numbersByFamily(counts, recipients)
	rows := []familyImportCandidate{{targets: []familyImportTarget{{family: "family@example.org", contractID: 2, firstDay: from}},
		row: parentbilling.FamilyChildrenImportRow{Children: ptr(2)}}}
	decideFamilyImport(rows, numbers, later.AddDays(10))
	assert.Equal(t, parentbilling.FamilyImportReady, rows[0].row.Status)
	assert.Equal(t, ptr(later.AddDays(1)), rows[0].row.ValidFrom, "renew only after every equal confirmation has expired")
	counts[1].ValidUntil = nil
	families := groupFamilies(nil, recipients, counts, later.AddDays(10))
	assert.Equal(t, parentbilling.FamilyChildrenConfirmed, families[0].Status, "an open confirmation outlives every finite one")
}

func TestFamilyMonthResolvesBothSourcesOnTheFirstValidDay(t *testing.T) {
	t.Parallel()
	january, middle, february := calendar.NewDate(2027, 1, 1), calendar.NewDate(2027, 1, 15), calendar.NewDate(2027, 2, 1)
	brought := &parentbilling.FamilyChildCount{ConfirmedChildren: ptr(3), ValidFrom: &january}
	for _, test := range []struct {
		name    string
		ownFrom calendar.Date
		want    int
	}{
		{"own starts mid-month", middle, 3},
		{"own starts on first", january, 2},
		{"own starts next month", february, 3},
	} {
		t.Run(test.name, func(t *testing.T) {
			numbers := familyNumbers{own: &parentbilling.FamilyChildCount{ConfirmedChildren: ptr(2), ValidFrom: &test.ownFrom},
				brought: []*parentbilling.FamilyChildCount{brought}}
			number, ok := numbers.confirmedIn(january)
			require.True(t, ok)
			assert.Equal(t, test.want, number)
			number, ok = numbers.confirmedIn(february)
			require.True(t, ok)
			assert.Equal(t, 2, number)
		})
	}
	numbers := familyNumbers{own: &parentbilling.FamilyChildCount{ConfirmedChildren: ptr(2), ValidFrom: &middle, ValidUntil: ptr(monthEnd(january))},
		brought: []*parentbilling.FamilyChildCount{brought}}
	_, ok := numbers.confirmedIn(february)
	assert.False(t, ok, "an expired own decision must not revive an older brought confirmation")
	brought.ValidFrom = ptr(january.AddDays(9))
	number, ok := numbers.confirmedIn(january)
	require.True(t, ok)
	assert.Equal(t, 3, number, "without a number on the first, use the first valid day across both sources")
}

type familySourceContracts struct {
	parentbilling.CareContracts
	versions   []parentbilling.CareContractVersion
	recipients map[int64]parentbilling.CareRecipient
}

func (c familySourceContracts) VersionsInForce(context.Context, int64, calendar.Date, calendar.Date) ([]parentbilling.CareContractVersion, error) {
	return c.versions, nil
}

func (c familySourceContracts) Recipients(_ context.Context, _ int64, ids []int64) (map[int64]parentbilling.CareRecipient, error) {
	result := map[int64]parentbilling.CareRecipient{}
	for _, id := range ids {
		if recipient, ok := c.recipients[id]; ok {
			result[id] = recipient
		}
	}
	return result, nil
}

type familySourceStore struct {
	CareStore
	FamilyChildrenStore
	counts []parentbilling.FamilyChildCount
}

func (familySourceStore) LockCareBilling(context.Context, int64) error {
	return nil
}

func (s familySourceStore) FamilyChildCounts(context.Context, int64) ([]parentbilling.FamilyChildCount, error) {
	return s.counts, nil
}

func (familySourceStore) CarePriceLists(context.Context, int64) ([]parentbilling.CareTariff, []parentbilling.CarePriceListHead, error) {
	return nil, nil, nil
}

func (familySourceStore) InvoicedContracts(context.Context, int64, calendar.Date) (map[int64]parentbilling.CareInvoice, error) {
	return nil, nil
}

func (familySourceStore) ListContributionRules(context.Context, int64, string) ([]parentbilling.ContributionRule, error) {
	return nil, nil
}

func (familySourceStore) CareEvidences(context.Context, int64, []int64) ([]parentbilling.CareEvidence, error) {
	return nil, nil
}

func (familySourceStore) CareCostShares(context.Context, int64, []int64) ([]parentbilling.CareCostShare, error) {
	return nil, nil
}

func (familySourceStore) InsertFamilyChildEvents(context.Context, int64, parentbilling.FamilyChildEvent, []parentbilling.FamilyChildTarget) error {
	return nil
}

func TestEndedContractStillSuppliesTheFamilyNumber(t *testing.T) {
	t.Parallel()
	month := calendar.NewDate(2027, 1, 1)
	store := familySourceStore{counts: []parentbilling.FamilyChildCount{{ContractID: 1, FamilyEmail: "contract:1",
		ConfirmedChildren: ptr(3), ValidFrom: &month}}}
	contracts := familySourceContracts{
		versions:   []parentbilling.CareContractVersion{{ContractID: 2, SchoolID: 7, ChildFirstName: "Mia", ChildLastName: "Beispiel", From: month}},
		recipients: map[int64]parentbilling.CareRecipient{1: {Email: "family@example.org"}, 2: {Email: "family@example.org"}},
	}
	billing := CareBilling{store: store, contracts: contracts}
	ctx := context.Background()
	monthly, err := billing.careMonthInput(ctx, 9, parentbilling.CareRun{BillingMonth: month}, parentbilling.MonthRuleVersionOnFirst)
	require.NoError(t, err)
	span, err := billing.spanInput(ctx, 9, month, monthEnd(month), parentbilling.MonthRuleVersionOnFirst)
	require.NoError(t, err)
	for _, input := range []careMonthInput{monthly, span} {
		assert.Equal(t, 3, familyChildrenIn(input.familyCounts, input.recipients, month)["family@example.org"])
	}
	imports := CareReductions{FamilyNumbers: &FamilyNumbers{store: store}, contracts: contracts, today: func() calendar.Date { return month }}
	index := familyImportIndex{schoolID: 7, fields: map[string]int{parentbilling.FamilyImportFieldChildFirstName: 0,
		parentbilling.FamilyImportFieldChildLastName: 1, parentbilling.FamilyImportFieldChildren: 2}}
	candidates, err := imports.familyImportCandidates(ctx, parentbilling.HolidayReviewer{OrganizationID: 9, AccountID: 8},
		importTable{rows: [][]string{{"Mia", "Beispiel", "2"}}, lines: []int{2}}, index, []parentbilling.CareSchool{{ID: 7}})
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, parentbilling.FamilyImportDiffers, candidates[0].row.Status, "the ended contract's valid confirmation is protected")
}
