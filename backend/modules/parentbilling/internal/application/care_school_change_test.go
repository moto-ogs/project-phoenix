package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// A child changes its school within the month (#7863 point 1). Under the
// full month only one contract of the child bills the month (ADR 0158 E2);
// the other one bills nothing, but it still places the child at its school
// for the sibling rule: every contract of the month counts. Prices as in
// TestCareMonthRuleChainTable. Mia books 80,00 € at Ispringen all month; the
// rule is half at Ispringen.

// schoolChangeContract is one contract of the table with its days.
type schoolChangeContract struct {
	contract    int64
	school      int64
	from, until string
	booked      []parentbilling.CareContractService
}

func TestCareMonthSchoolChangeWithinMonthCounts(t *testing.T) {
	t.Parallel()
	mia := schoolChangeContract{contractMia, schoolIspringen, billingMonth, "2027-01-31", []parentbilling.CareContractService{mon1400, tue1400}}
	// Noah leaves Birkenfeld on the 14th and starts at Ispringen on the 15th.
	toCounting := []schoolChangeContract{mia,
		{contractNoah, schoolBirkenfeld, billingMonth, "2027-01-14", []parentbilling.CareContractService{mon1400}},
		{contractLea, schoolIspringen, "2027-01-15", "2027-01-31", []parentbilling.CareContractService{mon1630}}}
	// The reverse: Noah leaves Ispringen and starts at Birkenfeld.
	fromCounting := []schoolChangeContract{mia,
		{contractNoah, schoolIspringen, billingMonth, "2027-01-14", []parentbilling.CareContractService{mon1630}},
		{contractLea, schoolBirkenfeld, "2027-01-15", "2027-01-31", []parentbilling.CareContractService{mon1400}}}
	cases := []struct {
		name      string
		monthRule string
		contracts []schoolChangeContract
		rules     func(t *testing.T) []parentbilling.ContributionRule
		families  func(t *testing.T) []parentbilling.FamilyChildCount
		uncounted int
		totals    map[int64]int64
		// rank and children are what Mia's sibling reduction names; zero
		// wants none.
		rank, children int
	}{
		{
			// Noah's contract at Ispringen bills nothing in January, yet
			// the family has two children with a contract there: Mia pays
			// 40,00 €. Noah's month is Birkenfeld's: 45,00 €, no rule there.
			name: "family size: the new contract at the counting school counts", contracts: toCounting,
			rules: familySizeRule(false, 2), totals: map[int64]int64{contractMia: 4000, contractNoah: 4500},
			rank: 1, children: 2,
		},
		{
			// With the family's number of two: Noah no longer comes off
			// it as a child elsewhere. Two children, Mia pays 40,00 €.
			name: "family size with the family's number: the child no longer comes off the number", contracts: toCounting,
			rules: familySizeRule(true, 2), families: confirmedFamily(familyEva, 2, "2026-09-01", nil),
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500}, rank: 1, children: 2,
		},
		{
			// Without a confirmed number the two contracts are the family
			// and the run still names it as uncounted.
			name: "family size without a confirmed number: counted and named", contracts: toCounting,
			rules: familySizeRule(true, 2), uncounted: 1,
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500}, rank: 1, children: 2,
		},
		{
			// Rank with the family's number of three: Mia, Noah and one
			// sibling without a contract. The sibling comes first, Noah
			// without a base price last (ADR 0115 point 3): Mia is the
			// 2nd of three, 40,00 €. The amount is the one from before
			// #7863; the family now counts three, not two.
			name: "rank with the family's number: the family counts the child", contracts: toCounting,
			rules: familySiblingRule(true), families: confirmedFamily(familyEva, 3, "2026-09-01", nil),
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500}, rank: 2, children: 3,
		},
		{
			// Rank with the family's number of two, both with a contract:
			// Noah ranks behind Mia, she stays the 1st and pays in full.
			name: "rank with the family's number of the contract children: the first child stays first", contracts: toCounting,
			rules: familySiblingRule(true), families: confirmedFamily(familyEva, 2, "2026-09-01", nil),
			totals: map[int64]int64{contractMia: 8000, contractNoah: 4500},
		},
		{
			// Rank without the family's number: a child without a base
			// price ranks behind (ADR 0115 point 3), no amount changes.
			name: "rank without the family's number: unchanged", contracts: toCounting,
			rules: familySiblingRule(false), totals: map[int64]int64{contractMia: 8000, contractNoah: 4500},
		},
		{
			// The reverse change: Noah's contract at Ispringen holds on
			// the 1st and bills January, 60,00 € − 50 % = 30,00 €; Mia
			// 40,00 €. The contract at Birkenfeld bills nothing.
			name: "family size: a change away from the counting school stays counted", contracts: fromCounting,
			rules: familySizeRule(false, 2), totals: map[int64]int64{contractMia: 4000, contractNoah: 3000},
			rank: 1, children: 2,
		},
		{
			// The reverse change under a rank rule with the number of two:
			// Mia 80,00 € is the 1st, Noah the 2nd: 30,00 €. His contract
			// at Birkenfeld does not take him off the number: a contract
			// at a counting school goes before one elsewhere.
			name: "rank with the family's number: a change away from the counting school stays counted", contracts: fromCounting,
			rules: familySiblingRule(true), families: confirmedFamily(familyEva, 2, "2026-09-01", nil),
			totals: map[int64]int64{contractMia: 8000, contractNoah: 3000},
		},
		{
			// Noah enters Ispringen on the 15th with his only contract:
			// it is his entry and bills the whole month (ADR 0158 E2),
			// 60,00 € − 50 % = 30,00 €.
			name: "family size: an entry within the month bills and counts", contracts: []schoolChangeContract{mia,
				{contractLea, schoolIspringen, "2027-01-15", "2027-01-31", []parentbilling.CareContractService{mon1630}}},
			rules: familySizeRule(false, 2), totals: map[int64]int64{contractMia: 4000, contractLea: 3000},
			rank: 1, children: 2,
		},
		{
			// Noah enters Birkenfeld on the 11th and changes to Ispringen
			// on the 21st: the entry at Birkenfeld bills the month, the
			// contract at Ispringen counts him there. Mia pays 40,00 €.
			name: "family size: a change after an entry within the month counts", contracts: []schoolChangeContract{mia,
				{contractNoah, schoolBirkenfeld, "2027-01-11", "2027-01-20", []parentbilling.CareContractService{mon1400}},
				{contractLea, schoolIspringen, "2027-01-21", "2027-01-31", []parentbilling.CareContractService{mon1630}}},
			rules: familySizeRule(false, 2), totals: map[int64]int64{contractMia: 4000, contractNoah: 4500},
			rank: 1, children: 2,
		},
		{
			// Pro rata every contract bills its days, so both counted
			// before #7863 too. Noah at Birkenfeld 14 of 31 days: 45,00 €
			// × 14 / 31 = 20,32 €. At Ispringen 17 days: 60,00 € × 17 / 31
			// = 32,90 €, half off: 16,45 €. Mia 40,00 €.
			name: "pro rata: unchanged", monthRule: parentbilling.MonthRuleProRata, contracts: toCounting,
			rules:  familySizeRule(false, 2),
			totals: map[int64]int64{contractMia: 4000, contractNoah: 2032, contractLea: 1645}, rank: 1, children: 2,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			monthRule := tc.monthRule
			if monthRule == "" {
				monthRule = parentbilling.MonthRuleVersionOnFirst
			}
			in := careMonthInput{month: day(t, billingMonth), rule: monthRule, tariffs: chainTariffs(t),
				invoiced: map[int64]parentbilling.CareInvoice{}, recipients: map[int64]parentbilling.CareRecipient{}, rules: tc.rules(t)}
			for _, contract := range tc.contracts {
				version := sjrVersion(t, contract.contract, contract.school, 1, contract.from, contract.until, contract.booked...)
				if contract.contract == contractLea {
					// Noah's second contract: the same child record.
					version.StudentID = ptr(contractNoah + 9000)
				}
				in.versions = append(in.versions, version)
				in.recipients[contract.contract] = parentbilling.CareRecipient{FirstName: "Eva", LastName: "Beispiel", Email: familyEva}
			}
			if tc.families != nil {
				in.familyCounts = tc.families(t)
			}
			month, err := buildCareMonth(in)
			require.NoError(t, err)
			assert.Empty(t, month.duplicates, "contracts one after the other are no duplicate")
			assert.Empty(t, month.unpriced)
			assert.Equal(t, tc.uncounted, month.uncounted, "families a rule counts without a confirmed number")
			for _, schools := range month.uncountedSchools {
				assert.Equal(t, []int64{schoolIspringen}, schools, "the uncounted family names the school the rule reduces")
			}
			totals := map[int64]int64{}
			var miaSibling []parentbilling.CareReduction
			for _, invoice := range month.invoices {
				totals[invoice.ContractID.Int64()] = invoice.TotalCents
				for _, reduction := range invoice.Reductions {
					if invoice.ContractID == ident.ID(contractMia) && reduction.Kind == parentbilling.RuleSibling {
						miaSibling = append(miaSibling, reduction)
					}
				}
			}
			assert.Equal(t, tc.totals, totals, "a contract that bills nothing gets no invoice")
			if tc.rank == 0 {
				assert.Empty(t, miaSibling)
				return
			}
			require.Len(t, miaSibling, 1)
			assert.Equal(t, tc.rank, *miaSibling[0].ChildRank, "Mia's rank")
			assert.Equal(t, tc.children, *miaSibling[0].FamilyChildren, "children of the family")
		})
	}
}

// A rule's own schools always count (#7863 point 2): the choice „Geschwister
// zählen auch an“ keeps only the other schools, so a stored rule says what
// the chain counts in addition.
func TestCareRuleCountChoiceKeepsOnlyOtherSchools(t *testing.T) {
	t.Parallel()
	schools := []parentbilling.CareSchool{{ID: ident.ID(schoolIspringen)}, {ID: ident.ID(schoolBirkenfeld)}}
	input := parentbilling.CareRuleInput{Kind: parentbilling.RuleSibling, Name: "Geschwister", ValidFrom: day(t, "2026-09-01"),
		SchoolIDs: []ident.ID{ident.ID(schoolIspringen)}, SiblingFromChild: ptr(2), DiscountBasisPoints: ptr(5000),
		CountSchoolIDs: []ident.ID{ident.ID(schoolBirkenfeld), ident.ID(schoolIspringen)}}
	normalized, err := normalizeCareRule(input, schools)
	require.NoError(t, err)
	assert.Equal(t, []ident.ID{ident.ID(schoolBirkenfeld)}, normalized.CountSchoolIDs)

	input.CountSchoolIDs = []ident.ID{ident.ID(schoolIspringen)}
	normalized, err = normalizeCareRule(input, schools)
	require.NoError(t, err)
	assert.Empty(t, normalized.CountSchoolIDs, "a choice of the rule's own schools alone is no choice")
	assert.NotNil(t, normalized.CountSchoolIDs)
}

func TestCarePreviewsCountAnIssuedChildWithAnotherContractOnce(t *testing.T) {
	t.Parallel()
	mia := sjrVersion(t, contractMia, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400, tue1400)
	noahEarly := sjrVersion(t, contractNoah, schoolBirkenfeld, 1, billingMonth, "2027-01-14", mon1400)
	noahLate := sjrVersion(t, contractLea, schoolIspringen, 2, "2027-01-15", "2027-01-31", mon1630)
	noahLate.StudentID = noahEarly.StudentID
	const assessedContract = contractLea + 1
	in := careMonthInput{
		month: day(t, billingMonth), rule: parentbilling.MonthRuleVersionOnFirst,
		versions: []parentbilling.CareContractVersion{mia, noahEarly, noahLate},
		tariffs:  chainTariffs(t), rules: familySizeRule(false, 3)(t),
		recipients: map[int64]parentbilling.CareRecipient{
			contractMia: {Email: familyEva}, contractNoah: {Email: familyEva}, contractLea: {Email: familyEva},
		},
		issuedChildren: map[int64]parentbilling.CareContractChild{assessedContract: {StudentID: noahEarly.StudentID}},
		invoiced: map[int64]parentbilling.CareInvoice{assessedContract: {
			ContractID: ident.ID(assessedContract), SchoolID: ident.ID(schoolIspringen),
			FamilyEmail: familyEva, DocumentKind: parentbilling.DocumentKindFeeNotice,
			Positions: []parentbilling.CarePosition{{CareOfferingID: ident.ID(moduleUntil1630), AmountCents: 6000, PayableCents: 6000}},
		}},
	}
	schools := []int64{schoolIspringen}
	monthly, err := buildCareMonth(in)
	require.NoError(t, err)
	_, notice, err := computeNoticeMonth(in, in.invoiced, nil, schools)
	require.NoError(t, err)
	for name, preview := range map[string]careMonth{"monthly run": narrowMonth(monthly, schools, nil).careMonth, "fee notice": notice} {
		require.Len(t, preview.invoices, 1, name)
		assert.Equal(t, ident.ID(contractMia), preview.invoices[0].ContractID, name)
		assert.Equal(t, int64(8000), preview.invoices[0].TotalCents, name+": two children do not qualify at the three-child threshold")
	}
}

func TestCareReviewDoesNotWarnAboutAnIssuedOnlyFamily(t *testing.T) {
	t.Parallel()
	noah := sjrVersion(t, contractNoah, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
	rules := familySiblingRule(true)(t)
	rules[0].CountSchoolIDs = ident.IDs([]int64{schoolBirkenfeld})
	in := careMonthInput{
		month: day(t, billingMonth), rule: parentbilling.MonthRuleVersionOnFirst,
		versions: []parentbilling.CareContractVersion{noah}, rules: rules,
		invoiced: map[int64]parentbilling.CareInvoice{contractNoah: {
			ContractID: ident.ID(contractNoah), SchoolID: ident.ID(schoolIspringen), FamilyEmail: familyEva,
			Positions: []parentbilling.CarePosition{{CareOfferingID: ident.ID(moduleUntil1400), AmountCents: 4000, PayableCents: 4000}},
		}},
	}
	computed, err := buildCareMonth(in)
	require.NoError(t, err)
	review := narrowMonth(computed, []int64{schoolIspringen}, nil)
	assert.Equal(t, 1, review.billed)
	assert.Empty(t, review.uncountedContracts)
	assert.Zero(t, review.uncounted, "no draft in the run needs a confirmation")
}

// An issued invoice of a contract outside the month ranks its child by the
// birth date Care Contract keeps (#7863): with the same base price the older
// sibling comes first and Mia, the younger, is the second child.
func TestCarePreviewsRankAnIssuedChildOutsideTheMonthByBirthDate(t *testing.T) {
	t.Parallel()
	mia := sjrVersion(t, contractMia, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400, tue1400)
	mia.ChildBirthDate = ptr(day(t, "2019-05-01"))
	const olderContract = contractLea + 1
	in := careMonthInput{
		month: day(t, billingMonth), rule: parentbilling.MonthRuleVersionOnFirst,
		versions: []parentbilling.CareContractVersion{mia}, tariffs: chainTariffs(t), rules: familySiblingRule(false)(t),
		recipients: map[int64]parentbilling.CareRecipient{contractMia: {Email: familyEva}},
		issuedChildren: map[int64]parentbilling.CareContractChild{olderContract: {StudentID: ptr(int64(olderContract + 9000)),
			FirstName: "Ben", LastName: "Beispiel", BirthDate: ptr(day(t, "2016-03-01"))}},
		invoiced: map[int64]parentbilling.CareInvoice{olderContract: {
			ContractID: ident.ID(olderContract), SchoolID: ident.ID(schoolIspringen), FamilyEmail: familyEva,
			Positions: []parentbilling.CarePosition{{CareOfferingID: ident.ID(moduleUntil1630), AmountCents: 8000, PayableCents: 8000}},
		}},
	}
	schools := []int64{schoolIspringen}
	monthly, err := buildCareMonth(in)
	require.NoError(t, err)
	_, notice, err := computeNoticeMonth(in, in.invoiced, nil, schools)
	require.NoError(t, err)
	for name, preview := range map[string]careMonth{"monthly run": narrowMonth(monthly, schools, nil).careMonth, "fee notice": notice} {
		require.Len(t, preview.invoices, 1, name)
		assert.Equal(t, int64(4000), preview.invoices[0].TotalCents, name+": the younger child is the second and pays half")
	}
}

// A child ranks by the birth date any of its entries knows (#7863): Ben's
// draft has none, his issued contract outside the month has one, so the
// older Ben comes first and the younger Mia is the second child.
func TestCarePreviewsRankAChildByTheBirthDateOfAnyEntry(t *testing.T) {
	t.Parallel()
	mia := sjrVersion(t, contractMia, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400, tue1400)
	mia.ChildBirthDate = ptr(day(t, "2019-05-01"))
	ben := sjrVersion(t, contractNoah, schoolIspringen, 2, billingMonth, "2027-01-31", mon1400)
	ben.ChildFirstName, ben.ChildBirthDate = "Ben", nil
	const issuedContract = contractLea + 1
	in := careMonthInput{
		month: day(t, billingMonth), rule: parentbilling.MonthRuleVersionOnFirst,
		versions: []parentbilling.CareContractVersion{mia, ben}, tariffs: chainTariffs(t), rules: familySiblingRule(false)(t),
		recipients: map[int64]parentbilling.CareRecipient{contractMia: {Email: familyEva}, contractNoah: {Email: familyEva}},
		issuedChildren: map[int64]parentbilling.CareContractChild{issuedContract: {StudentID: ben.StudentID,
			FirstName: "Ben", LastName: "Beispiel", BirthDate: ptr(day(t, "2016-03-01"))}},
		invoiced: map[int64]parentbilling.CareInvoice{issuedContract: {
			ContractID: ident.ID(issuedContract), SchoolID: ident.ID(schoolIspringen), FamilyEmail: familyEva,
			Positions: []parentbilling.CarePosition{{CareOfferingID: ident.ID(moduleUntil1630), AmountCents: 4000, PayableCents: 4000}},
		}},
	}
	schools := []int64{schoolIspringen}
	monthly, err := buildCareMonth(in)
	require.NoError(t, err)
	_, notice, err := computeNoticeMonth(in, in.invoiced, nil, schools)
	require.NoError(t, err)
	for name, preview := range map[string]careMonth{"monthly run": narrowMonth(monthly, schools, nil).careMonth, "fee notice": notice} {
		totals := map[ident.ID]int64{}
		for _, invoice := range preview.invoices {
			totals[invoice.ContractID] = invoice.TotalCents
		}
		assert.Equal(t, map[ident.ID]int64{ident.ID(contractMia): 4000, ident.ID(contractNoah): 4000}, totals, name)
	}
}

// A child ranks by the birth date an entry at any school knows (#7863):
// Ben's issued invoice is at Birkenfeld, which the rule does not count, and
// still tells that Ben is older. Both pay 40,00 € at Ispringen; Mia, the
// younger, is the second child and pays half.
func TestCarePreviewsRankByABirthDateFromAnotherSchool(t *testing.T) {
	t.Parallel()
	mia := sjrVersion(t, contractMia, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
	mia.ChildBirthDate = ptr(day(t, "2019-05-01"))
	ben := sjrVersion(t, contractNoah, schoolIspringen, 2, billingMonth, "2027-01-31", mon1400)
	ben.ChildFirstName, ben.ChildBirthDate = "Ben", nil
	const issuedContract = contractLea + 1
	in := careMonthInput{
		month: day(t, billingMonth), rule: parentbilling.MonthRuleVersionOnFirst,
		versions: []parentbilling.CareContractVersion{mia, ben}, tariffs: chainTariffs(t), rules: familySiblingRule(false)(t),
		recipients: map[int64]parentbilling.CareRecipient{contractMia: {Email: familyEva}, contractNoah: {Email: familyEva}},
		issuedChildren: map[int64]parentbilling.CareContractChild{issuedContract: {StudentID: ben.StudentID,
			FirstName: "Ben", LastName: "Beispiel", BirthDate: ptr(day(t, "2016-03-01"))}},
		invoiced: map[int64]parentbilling.CareInvoice{issuedContract: {
			ContractID: ident.ID(issuedContract), SchoolID: ident.ID(schoolBirkenfeld), FamilyEmail: familyEva,
			Positions: []parentbilling.CarePosition{{CareOfferingID: ident.ID(moduleUntil1630), AmountCents: 4500, PayableCents: 4500}},
		}},
	}
	schools := []int64{schoolIspringen}
	monthly, err := buildCareMonth(in)
	require.NoError(t, err)
	_, notice, err := computeNoticeMonth(in, in.invoiced, nil, schools)
	require.NoError(t, err)
	for name, preview := range map[string]careMonth{"monthly run": narrowMonth(monthly, schools, nil).careMonth, "fee notice": notice} {
		totals := map[ident.ID]int64{}
		for _, invoice := range preview.invoices {
			totals[invoice.ContractID] = invoice.TotalCents
		}
		assert.Equal(t, map[ident.ID]int64{ident.ID(contractMia): 2000, ident.ID(contractNoah): 4000}, totals, name)
	}
}
