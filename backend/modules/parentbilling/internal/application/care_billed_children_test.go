package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// "Already billed" counts per child, not per contract (#7892, ADR 0158
// Nachtrag "Schon abgerechnet je Kind"). Setup and prices as in
// TestCareMonthCountsAChildWithARecordAtEachSchoolOnce: Mia books 80,00 € at
// Ispringen all month; Noah leaves Birkenfeld on the 14th (45,00 € a month)
// and starts at Ispringen on the 15th (60,00 € a month).

// billedMonth builds the input of a month from the contracts of the table.
func billedMonth(t *testing.T, monthRule string, rules []parentbilling.ContributionRule, contracts ...identityContract) careMonthInput {
	t.Helper()
	in := careMonthInput{month: day(t, billingMonth), rule: monthRule, tariffs: chainTariffs(t), rules: rules,
		invoiced: map[int64]parentbilling.CareInvoice{}, recipients: map[int64]parentbilling.CareRecipient{},
		issuedChildren: map[int64]parentbilling.CareContractChild{}}
	for _, contract := range contracts {
		version := sjrVersion(t, contract.contract, contract.school, 1, contract.from, contract.until, contract.booked...)
		version.StudentID = nil
		if contract.student != 0 {
			version.StudentID = ptr(contract.student)
		}
		version.SchoolName = schoolNames[contract.school]
		version.ChildFirstName, version.ChildLastName = contract.first, contract.last
		if contract.birth != "" {
			version.ChildBirthDate = ptr(day(t, contract.birth))
		}
		in.versions = append(in.versions, version)
		in.recipients[contract.contract] = parentbilling.CareRecipient{FirstName: "Eva", LastName: "Beispiel", Email: contract.email}
	}
	return in
}

// issuedFor is the invoice an earlier run issued for a contract: one care
// position of cents from the first to the last day, none for cents 0 (an
// invoice that carries only the Mensa).
func issuedFor(t *testing.T, contract identityContract, number string, cents int64, from, until string) parentbilling.CareInvoice {
	t.Helper()
	billedBy := parentbilling.CareBilledInvoice{Source: parentbilling.BilledByCareRun, RunID: 31, ContractID: ident.ID(contract.contract),
		SchoolID: ident.ID(contract.school), SchoolName: schoolNames[contract.school], Number: number,
		DocumentKind: parentbilling.DocumentKindInvoice}
	invoice := parentbilling.CareInvoice{ID: ident.ID(contract.contract + 9000), ContractID: ident.ID(contract.contract),
		SchoolID: ident.ID(contract.school), SchoolName: schoolNames[contract.school], FamilyEmail: parentbilling.FamilyKey(contract.email),
		TotalCents: cents, BilledBy: []parentbilling.CareBilledInvoice{billedBy}}
	if cents > 0 {
		invoice.Positions = []parentbilling.CarePosition{{CareOfferingID: ident.ID(contract.booked[0].CareOfferingID), AmountCents: cents,
			PayableCents: cents}}
		// A position without its days, as an old notice month keeps it,
		// bills the whole month.
		if from != "" {
			invoice.Positions[0].ServiceFrom, invoice.Positions[0].ServiceUntil = day(t, from), day(t, until)
		}
	}
	return invoice
}

// draftTotals are the totals of the drafts of a month by contract.
func draftTotals(month careMonth) map[int64]int64 {
	totals := map[int64]int64{}
	for _, invoice := range month.invoices {
		totals[invoice.ContractID.Int64()] = invoice.TotalCents
	}
	return totals
}

// miaSiblingChildren is the family size Mia's sibling reduction names, zero
// without one.
func miaSiblingChildren(month careMonth) int {
	for _, invoice := range month.invoices {
		for _, reduction := range invoice.Reductions {
			if invoice.ContractID == ident.ID(contractMia) && reduction.Kind == parentbilling.RuleSibling {
				return *reduction.FamilyChildren
			}
		}
	}
	return 0
}

func billedTable(t *testing.T) (mia, leaves, enters identityContract) {
	t.Helper()
	mia = identityContract{contract: contractMia, school: schoolIspringen, student: 9501, from: billingMonth, until: "2027-01-31",
		first: "Mia", last: "Beispiel", birth: "2016-05-06", email: familyEva, booked: []parentbilling.CareContractService{mon1400, tue1400}}
	leaves = noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	enters = noahAt(contractLea, schoolIspringen, noahIspringenRecord, "2027-01-15", "2027-01-31", mon1630)
	return mia, leaves, enters
}

// Case 1 of #7892, the double invoice over two runs. An earlier run issued
// the contract at Ispringen as Noah's entry of January, 60,00 €, before the
// contract at Birkenfeld reached moto. That contract holds on the 1st, so
// the next run billed it for the whole month as well: 45,00 € on top. Now the
// run holds Noah back and names the issued invoice.
func TestCareMonthHoldsAChildAnotherContractAlreadyBilled(t *testing.T) {
	t.Parallel()
	mia, leaves, enters := billedTable(t)
	withoutRecord := enters
	withoutRecord.student = 0
	cases := []struct {
		name   string
		enters identityContract
	}{
		{"a record at each school", enters},
		// The contract at the new school names no record: E1 joins it to
		// Noah's record by his name and date of birth.
		{"one record", withoutRecord},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, identityRules(t, 0, false), mia, leaves, tc.enters)
			in.invoiced[contractLea] = issuedFor(t, tc.enters, "R-2027-0007", 6000, billingMonth, "2027-01-31")
			month, err := buildCareMonth(in)
			require.NoError(t, err)
			assert.Equal(t, map[int64]int64{contractMia: 4000}, draftTotals(month),
				"Noah's January is billed already: no second invoice for the contract at Birkenfeld")
			assert.Equal(t, 2, miaSiblingChildren(month), "Noah still counts once for Mia")
			assert.Empty(t, month.duplicates)
			require.Len(t, month.billedChildren, 1, "the review names Noah")
			held := month.billedChildren[0]
			assert.Equal(t, "Noah", held.ChildFirstName)
			assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, held.Reason)
			assert.Equal(t, []parentbilling.CareDuplicateContract{
				{ContractID: ident.ID(contractNoah), SchoolID: ident.ID(schoolBirkenfeld), SchoolName: "Grundschule Birkenfeld"},
			}, held.Contracts, "the contract the run would bill")
			assert.Equal(t, in.invoiced[contractLea].BilledBy, held.Invoices, "the invoice in its way")
			// The run of the school of the held contract names him.
			assert.Len(t, narrowMonth(month, []int64{schoolBirkenfeld}, nil).billedChildren, 1)
			assert.Empty(t, narrowMonth(month, []int64{schoolBirkenfeld + 100}, nil).billedChildren)
		})
	}
}

// Case 2 of #7892. Noah's contract at Ispringen billed no care in January
// (the one at Birkenfeld did) and got an invoice with only his Mensa. The
// contract at Birkenfeld was ended and its invoice cancelled, so the one at
// Ispringen is Noah's entry now. Its invoice still stands, and a contract has
// one invoice a month: its care stays unbilled. The review names it.
func TestCareMonthNamesAMealOnlyInvoiceThatBlocksTheCare(t *testing.T) {
	t.Parallel()
	mia, _, enters := billedTable(t)
	in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, identityRules(t, 0, false), mia, enters)
	in.invoiced[contractLea] = issuedFor(t, enters, "R-2027-0008", 0, "", "")
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{contractMia: 4000}, draftTotals(month), "the issued contract gets no second invoice")
	require.Len(t, month.billedChildren, 1, "the review names Noah, whose care of January nobody bills")
	held := month.billedChildren[0]
	assert.Equal(t, "Noah", held.ChildFirstName)
	assert.Equal(t, parentbilling.HoldReasonMealOnlyInvoice, held.Reason)
	assert.Equal(t, []parentbilling.CareDuplicateContract{
		{ContractID: ident.ID(contractLea), SchoolID: ident.ID(schoolIspringen), SchoolName: "Grundschule Ispringen"},
	}, held.Contracts)
	assert.Equal(t, in.invoiced[contractLea].BilledBy, held.Invoices, "the Mensa invoice to cancel")

	// While the contract at Birkenfeld still bills the month, the Mensa
	// invoice blocks nothing: the contract at Ispringen bills no care.
	_, leaves, _ := billedTable(t)
	in = billedMonth(t, parentbilling.MonthRuleVersionOnFirst, identityRules(t, 0, false), mia, leaves, enters)
	in.invoiced[contractLea] = issuedFor(t, enters, "R-2027-0008", 0, "", "")
	month, err = buildCareMonth(in)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{contractMia: 4000, contractNoah: 4500}, draftTotals(month))
	assert.Empty(t, month.billedChildren)
}

// Case 3 of #7892. The contract at Birkenfeld has an issued invoice for
// January, 45,00 €, and was withdrawn afterwards: only its invoice brings it
// into the month. The contract at Ispringen, from the 15th, is Noah's entry
// and was billed for the whole month too, and the sibling rule counted Noah
// twice. Both schools count and the rule reduces from three children: Mia and
// Noah are two, so nobody pays less.
func TestCareMonthHoldsAChildAWithdrawnContractAlreadyBilled(t *testing.T) {
	t.Parallel()
	mia, leaves, enters := billedTable(t)
	sameRecord := enters
	sameRecord.student = noahBirkenfeldRecord
	cases := []struct {
		name   string
		enters identityContract
	}{
		{"a record at each school", enters},
		{"one record", sameRecord},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, identityRules(t, 3, true), mia, tc.enters)
			in.invoiced[contractNoah] = issuedFor(t, leaves, "R-2027-0003", 4500, billingMonth, "2027-01-31")
			in.issuedChildren[contractNoah] = parentbilling.CareContractChild{StudentID: ptr(noahBirkenfeldRecord),
				FirstName: "Noah", LastName: "Beispiel", BirthDate: ptr(day(t, noahBirth))}
			month, err := buildCareMonth(in)
			require.NoError(t, err)
			assert.Equal(t, map[int64]int64{contractMia: 8000}, draftTotals(month),
				"Noah's January is billed already, and he is one child: no second invoice, no sibling reduction")
			assert.Zero(t, miaSiblingChildren(month), "two children do not reach the rule's three")
			require.Len(t, month.billedChildren, 1, "the review names Noah")
			held := month.billedChildren[0]
			assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, held.Reason)
			assert.Equal(t, []parentbilling.CareDuplicateContract{
				{ContractID: ident.ID(contractLea), SchoolID: ident.ID(schoolIspringen), SchoolName: "Grundschule Ispringen"},
			}, held.Contracts)
			assert.Equal(t, in.invoiced[contractNoah].BilledBy, held.Invoices)
		})
	}
}

// What does not hold a child back (#7892). Under the full month every
// invoice bills the whole month; pro rata each contract bills its own days.
func TestCareMonthBillsNextToAnIssuedInvoiceThatIsNotInTheWay(t *testing.T) {
	t.Parallel()
	mia, leaves, enters := billedTable(t)
	early := noahAt(contractLea, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-31", mon1400)
	early.contract = contractLea + 1
	fullMonth, proRata := parentbilling.MonthRuleVersionOnFirst, parentbilling.MonthRuleProRata
	cases := []struct {
		name      string
		monthRule string
		contracts []identityContract
		issued    func(t *testing.T) map[int64]parentbilling.CareInvoice
		totals    map[int64]int64
		held      []int64
	}{
		{
			// Pro rata the contract at Ispringen billed its own days, the 15th
			// to the 31st. The contract at Birkenfeld bills the 1st to the
			// 14th: 45,00 € * 14/31 = 20,32 €.
			name: "pro rata: own days next to the issued days", monthRule: proRata, contracts: []identityContract{mia, leaves, enters},
			issued: func(t *testing.T) map[int64]parentbilling.CareInvoice {
				return map[int64]parentbilling.CareInvoice{contractLea: issuedFor(t, enters, "R-2027-0007", 1645, "2027-01-15", "2027-01-31")}
			},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 2032},
		},
		{
			// The invoice of the contract at Ispringen billed the whole month
			// when it still began on the 1st. Its contract now begins on the
			// 15th, so the 1st to the 14th are billed already: Noah is held.
			name: "pro rata: the issued invoice bills days of the other contract", monthRule: proRata,
			contracts: []identityContract{mia, leaves, enters},
			issued: func(t *testing.T) map[int64]parentbilling.CareInvoice {
				return map[int64]parentbilling.CareInvoice{contractLea: issuedFor(t, enters, "R-2027-0007", 6000, billingMonth, "2027-01-31")}
			},
			totals: map[int64]int64{contractMia: 4000}, held: []int64{contractNoah},
		},
		{
			// After the Storno no invoice bills Noah's January: the next run
			// bills the contract that holds on the 1st, 45,00 €.
			name: "full month: after the Storno the run bills the month", monthRule: fullMonth,
			contracts: []identityContract{mia, leaves, enters},
			issued:    func(*testing.T) map[int64]parentbilling.CareInvoice { return map[int64]parentbilling.CareInvoice{} },
			totals:    map[int64]int64{contractMia: 4000, contractNoah: 4500},
		},
		{
			// Two contracts of Noah's record hold on the 1st with their own
			// modules, and an earlier run issued one of them: its invoice
			// bills what its contract bills today, so the other one is billed.
			name: "full month: a second contract on the 1st with another module", monthRule: fullMonth,
			contracts: []identityContract{mia, early, noahAt(contractNoah, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-31", mon1630)},
			issued: func(t *testing.T) map[int64]parentbilling.CareInvoice {
				return map[int64]parentbilling.CareInvoice{early.contract: issuedFor(t, early, "R-2027-0002", 4500, billingMonth, "2027-01-31")}
			},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 3000},
		},
		{
			// A Jahresbescheid took the month of the contract at Ispringen
			// back to nothing (ADR 0182): it bills no care, so it holds no
			// other contract of Noah back.
			name: "full month: a notice month set to nothing", monthRule: fullMonth, contracts: []identityContract{mia, leaves, enters},
			issued: func(t *testing.T) map[int64]parentbilling.CareInvoice {
				notice := issuedFor(t, enters, "B-2027-0001", 0, "", "")
				notice.ID, notice.Number, notice.DocumentKind = 0, "B-2027-0001", parentbilling.DocumentKindFeeNotice
				return map[int64]parentbilling.CareInvoice{contractLea: notice}
			},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in := billedMonth(t, tc.monthRule, identityRules(t, 0, false), tc.contracts...)
			in.invoiced = tc.issued(t)
			month, err := buildCareMonth(in)
			require.NoError(t, err)
			assert.Equal(t, tc.totals, draftTotals(month))
			var held []int64
			for _, child := range month.billedChildren {
				for _, contract := range child.Contracts {
					held = append(held, contract.ContractID.Int64())
				}
			}
			assert.Equal(t, tc.held, held, "held contracts")
		})
	}
}

// A Jahresbescheid that assesses the month for a contract no longer in force
// holds the child's new contract like an issued invoice does (#7892), and
// the review names the notice. The notice preview computes the month the
// same way.
func TestCareMonthHoldsAChildAJahresbescheidAlreadyBilled(t *testing.T) {
	t.Parallel()
	mia, leaves, enters := billedTable(t)
	in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, identityRules(t, 0, false), mia, enters)
	notice := issuedFor(t, leaves, "B-2027-0004", 4500, "", "")
	notice.ID, notice.Number, notice.DocumentKind = 0, "B-2027-0004", parentbilling.DocumentKindFeeNotice
	notice.BilledBy[0].Source, notice.BilledBy[0].DocumentKind = parentbilling.BilledByNoticeRun, parentbilling.DocumentKindFeeNotice
	in.invoiced[contractNoah] = notice
	in.issuedChildren[contractNoah] = parentbilling.CareContractChild{StudentID: ptr(noahBirkenfeldRecord),
		FirstName: "Noah", LastName: "Beispiel", BirthDate: ptr(day(t, noahBirth))}
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{contractMia: 4000}, draftTotals(month))
	require.Len(t, month.billedChildren, 1)
	assert.Equal(t, notice.BilledBy, month.billedChildren[0].Invoices, "the Jahresbescheid in its way")
	// Noah is one child across the schools, and the review says so.
	require.Len(t, month.joined, 1)
	assert.Equal(t, []parentbilling.CareDuplicateContract{
		{ContractID: ident.ID(contractNoah), SchoolID: ident.ID(schoolBirkenfeld), SchoolName: "Grundschule Birkenfeld"},
		{ContractID: ident.ID(contractLea), SchoolID: ident.ID(schoolIspringen), SchoolName: "Grundschule Ispringen"},
	}, month.joined[0].Contracts, "the contract of the invoice first: it runs before the month")

	schools := []int64{schoolIspringen, schoolBirkenfeld}
	review, final, err := computeNoticeMonth(in, in.invoiced, nil, schools)
	require.NoError(t, err)
	assert.Equal(t, month.billedChildren, review.billedChildren, "the notice preview names the same children")
	assert.Equal(t, map[int64]int64{contractMia: 4000}, draftTotals(final))
	assert.True(t, heldOrUnpriced(&month)[contractLea], "a held contract keeps the assessment of its notice and gets no Mensa invoice")
}

// A contract only an issued invoice names is a part of a school change like
// a contract in force (ADR 0158, Nachtrag #7892): it joins under the rules
// of #7874 and not otherwise.
func TestCareSchoolChangeJoinsAContractOnlyAnInvoiceNames(t *testing.T) {
	t.Parallel()
	birth := ptr(day(t, noahBirth))
	enters := sjrVersion(t, 832, schoolIspringen, 1, "2027-01-15", "2027-01-31", mon1400)
	enters.StudentID, enters.ChildFirstName, enters.ChildBirthDate = ptr(int64(9832)), "Noah", birth
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{enters})
	families := contractFamilies(byContract, map[int64]parentbilling.CareRecipient{832: {Email: familyEva}})
	noah := parentbilling.CareContractChild{StudentID: ptr(int64(9831)), FirstName: "Noah", LastName: "Beispiel", BirthDate: birth}
	at := func(school int64) map[int64]parentbilling.CareDuplicateContract {
		return map[int64]parentbilling.CareDuplicateContract{831: {ContractID: 831, SchoolID: ident.ID(school)}}
	}
	eva := map[int64]string{831: parentbilling.FamilyKey(familyEva)}
	group := func(child parentbilling.CareContractChild, frozen map[int64]string, places map[int64]parentbilling.CareDuplicateContract) careGrouping {
		return groupCareMonth(byContract, order, families, map[int64]parentbilling.CareContractChild{831: child}, frozen, places)
	}

	joined := group(noah, eva, at(schoolBirkenfeld))
	require.Len(t, joined.joined, 1)
	assert.Equal(t, "contract:831", joined.keys[832], "the joined child keeps the key its issued invoice was ranked by")
	assert.Equal(t, joined.keys[831], joined.keys[832])
	assert.Equal(t, [][]int64{{832}}, joined.children, "the days of the month are those of the contract in force")

	apart := chainKeys(byContract, chainChildren(byContract, order, map[int64]parentbilling.CareContractChild{831: noah}))
	for name, grouping := range map[string]careGrouping{
		"another family froze the invoice":    group(noah, map[int64]string{831: parentbilling.FamilyKey(familyOther)}, at(schoolBirkenfeld)),
		"the same school: the record decides": group(noah, eva, at(schoolIspringen)),
		"no school of the invoice known":      group(noah, eva, nil),
		"another date of birth": group(parentbilling.CareContractChild{StudentID: noah.StudentID, FirstName: "Noah", LastName: "Beispiel",
			BirthDate: ptr(day(t, "2018-03-05"))}, eva, at(schoolBirkenfeld)),
		"no date of birth": group(parentbilling.CareContractChild{StudentID: noah.StudentID, FirstName: "Noah", LastName: "Beispiel"},
			eva, at(schoolBirkenfeld)),
	} {
		assert.Empty(t, grouping.joined, name)
		assert.Equal(t, apart, grouping.keys, name+": the chain as before")
	}
}

// The release stores the children held for an issued invoice after those
// with a duplicate contract, and a released run shows exactly what it
// stored (E5). The fingerprint of the review covers them, and a review
// without one keeps its fingerprint.
func TestCareReleaseKeepsTheChildrenAnIssuedInvoiceBills(t *testing.T) {
	t.Parallel()
	billed := []parentbilling.CareBilledChild{{ChildFirstName: "Noah", ChildLastName: "Beispiel", Reason: parentbilling.HoldReasonAlreadyBilled,
		Contracts: []parentbilling.CareDuplicateContract{{ContractID: ident.ID(contractNoah), SchoolID: ident.ID(schoolBirkenfeld), SchoolName: "Grundschule Birkenfeld"}},
		Invoices: []parentbilling.CareBilledInvoice{{Source: parentbilling.BilledByCareRun, RunID: 31, ContractID: ident.ID(contractLea),
			SchoolID: ident.ID(schoolIspringen), SchoolName: "Grundschule Ispringen", Number: "R-2027-0007", DocumentKind: parentbilling.DocumentKindInvoice}}}}
	duplicates := []parentbilling.CareDuplicate{{ChildFirstName: "Mia", ChildLastName: "Beispiel", ModuleName: "Betreuung bis 14:00 Uhr", Weekday: "mon",
		Contracts: []parentbilling.CareDuplicateContract{{ContractID: ident.ID(contractMia), SchoolID: ident.ID(schoolIspringen)}}}}
	snapshot := releaseSnapshot(duplicates, billed)
	require.Len(t, snapshot, 2)
	assert.Equal(t, []int{1, 2}, []int{snapshot[0].Position, snapshot[1].Position})
	assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, snapshot[1].Reason)
	assert.Equal(t, billed, billedHoldView(snapshot), "the released run shows the held children as the review did")
	assert.Equal(t, duplicates, holdView(snapshot), "and the duplicates without them")

	run := parentbilling.CareRun{ID: 7, SchoolIDs: ident.IDs([]int64{schoolBirkenfeld})}
	plain := narrowMonth(careMonth{}, []int64{schoolBirkenfeld}, nil)
	held := narrowMonth(careMonth{billedChildren: billed}, []int64{schoolBirkenfeld}, nil)
	before := previewFingerprint(run, parentbilling.MonthRuleVersionOnFirst, plain)
	assert.NotEqual(t, before, previewFingerprint(run, parentbilling.MonthRuleVersionOnFirst, held), "a held child changes the fingerprint")
	held.billedChildren = nil
	assert.Equal(t, before, previewFingerprint(run, parentbilling.MonthRuleVersionOnFirst, held), "a review without one keeps its fingerprint")
	assert.True(t, emptyCareReview(narrowMonth(careMonth{billedChildren: billed}, []int64{schoolBirkenfeld}, nil)),
		"a run that only holds such a child can be discarded: its month may be billed rightly")
}

// The read of a run records the contracts of the children it holds for an
// issued invoice and the contract of that invoice (#7892).
func TestRunReadsRecordTheContractsOfAChildAnInvoiceBills(t *testing.T) {
	t.Parallel()
	billed := []parentbilling.CareBilledChild{{
		Contracts: []parentbilling.CareDuplicateContract{{ContractID: ident.ID(contractNoah)}},
		Invoices:  []parentbilling.CareBilledInvoice{{ContractID: ident.ID(contractLea)}},
	}}
	monthly := parentbilling.CareRunDetail{Invoices: []parentbilling.CareInvoice{{ContractID: ident.ID(contractMia)}}, BilledChildren: billed}
	assert.Equal(t, []int64{contractMia, contractNoah, contractLea}, shownContracts(monthly))
	notice := parentbilling.CareNoticeRunDetail{Notices: []parentbilling.CareNotice{{ContractID: ident.ID(contractMia)}}, BilledChildren: billed}
	assert.Equal(t, []int64{contractMia, contractNoah, contractLea}, shownNoticeContracts(notice))
}

// The review list names the children the run holds back for an issued
// invoice with that invoice (#7892).
func TestCareReviewListNamesTheChildrenAnIssuedInvoiceBills(t *testing.T) {
	t.Parallel()
	contract := []parentbilling.CareDuplicateContract{{ContractID: ident.ID(contractNoah), SchoolName: "Grundschule Birkenfeld"}}
	rows := reviewHeldRows(parentbilling.CareRunDetail{BilledChildren: []parentbilling.CareBilledChild{
		{ChildFirstName: "Noah", ChildLastName: "Beispiel", Reason: parentbilling.HoldReasonAlreadyBilled, Contracts: contract,
			Invoices: []parentbilling.CareBilledInvoice{{Source: parentbilling.BilledByCareRun, Number: "R-2027-0007"},
				{Source: parentbilling.BilledByNoticeRun, Number: "B-2027-0004"}}},
		{ChildFirstName: "Lea", ChildLastName: "Beispiel", Reason: parentbilling.HoldReasonMealOnlyInvoice, Contracts: contract,
			Invoices: []parentbilling.CareBilledInvoice{{Source: parentbilling.BilledByCareRun, Number: "R-2027-0008",
				DocumentKind: parentbilling.DocumentKindFeeNotice}}},
	}}, "02.01.2027")
	assert.Equal(t, []map[string]string{
		{"invoice_date": "02.01.2027", "school": "Grundschule Birkenfeld", "child": "Noah Beispiel",
			"position": "Rechnung R-2027-0007, Jahresbescheid B-2027-0004", "status": "Nicht abgerechnet: Monat schon abgerechnet"},
		{"invoice_date": "02.01.2027", "school": "Grundschule Birkenfeld", "child": "Lea Beispiel",
			"position": "Bescheid R-2027-0008", "status": "Betreuung nicht abgerechnet: Rechnung nur mit Mensa"},
	}, rows)
}
