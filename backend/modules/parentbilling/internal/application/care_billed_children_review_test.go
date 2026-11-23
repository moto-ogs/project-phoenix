package application

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Cases of the review of #7892 (PR #7938). Setup and prices as in
// care_billed_children_test.go: Birkenfeld 45,00 € a month, Ispringen
// 60,00 €.

// noahIdentity is the child an issued contract outside the month names.
func noahIdentity(t *testing.T, record int64) parentbilling.CareContractChild {
	t.Helper()
	return parentbilling.CareContractChild{StudentID: ptr(record), FirstName: "Noah", LastName: "Beispiel", BirthDate: ptr(day(t, noahBirth))}
}

// heldContractsOf are the contracts the month holds back for an issued
// invoice.
func heldContractsOf(children []parentbilling.CareBilledChild) []int64 {
	held := []int64{}
	for _, child := range children {
		for _, contract := range child.Contracts {
			held = append(held, contract.ContractID.Int64())
		}
	}
	return held
}

// A notice run computes a month twice when a noticed contract is held: the
// second time with its old assessment as issued. The child the first
// computation held stays held as a whole (S4, S11). Pro rata, one record:
// the withdrawn contract billed the 1st to the 14th, 20,32 €. The contract
// that runs on those days has a notice that set January to nothing; a third
// one runs from the 15th, 60,00 € * 17/31 = 32,90 €. The first computation
// holds both for the invoice. The second one took the first contract back as
// issued and then billed the third one, although the review named it held.
func TestCareNoticeMonthKeepsAChildHeldInBothComputations(t *testing.T) {
	t.Parallel()
	const withdrawnContract = contractLea + 10
	early := noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	late := noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630)
	withdrawn := early
	withdrawn.contract = withdrawnContract
	in := billedMonth(t, parentbilling.MonthRuleProRata, nil, early, late)
	in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
	setToNothing := issuedFor(t, early, "B-2027-0001", 0, "", "")
	setToNothing.ID, setToNothing.Number, setToNothing.DocumentKind = 0, "B-2027-0001", parentbilling.DocumentKindFeeNotice
	invoiced := map[int64]parentbilling.CareInvoice{
		withdrawnContract: issuedFor(t, withdrawn, "R-2027-0003", 2032, billingMonth, "2027-01-14"),
		contractNoah:      setToNothing,
	}
	review, final, err := computeNoticeMonth(in, invoiced, map[int64]bool{contractNoah: true}, []int64{schoolBirkenfeld, schoolIspringen})
	require.NoError(t, err)
	assert.ElementsMatch(t, []int64{contractNoah, contractLea}, heldContractsOf(review.billedChildren), "the review names Noah with both contracts")
	assert.Empty(t, draftTotals(final), "a held child gets no assessment for a contract of its own")
}

// An issued entry that bills no care takes no part in a school change (S6):
// a Jahresbescheid month set to nothing, or an invoice with only the Mensa,
// of a namesake of another family whose contract no longer runs. Noah's
// change of school joins as before #7892: his contract at Birkenfeld bills
// January, 45,00 €, the one at Ispringen nothing. With the namesake in the
// way the contract at Ispringen was Noah's entry too: 60,00 € on top.
func TestCareSchoolChangeIgnoresAnIssuedEntryThatBillsNoCare(t *testing.T) {
	t.Parallel()
	_, leaves, enters := billedTable(t)
	const namesakeContract = contractLea + 20
	namesake := noahAt(namesakeContract, schoolIspringen, 9700, billingMonth, "2027-01-31", mon1630)
	namesake.email = familyOther
	notice := issuedFor(t, namesake, "B-2027-0002", 0, "", "")
	notice.ID, notice.Number, notice.DocumentKind = 0, "B-2027-0002", parentbilling.DocumentKindFeeNotice
	for name, entry := range map[string]parentbilling.CareInvoice{
		"a notice month set to nothing":  notice,
		"an invoice with only the Mensa": issuedFor(t, namesake, "R-2027-0009", 0, "", ""),
	} {
		in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, nil, leaves, enters)
		in.invoiced[namesakeContract] = entry
		in.issuedChildren[namesakeContract] = noahIdentity(t, 9700)
		month, err := buildCareMonth(in)
		require.NoError(t, err, name)
		assert.Equal(t, map[int64]int64{contractNoah: 4500}, draftTotals(month), name)
		assert.Len(t, month.joined, 1, name+": Noah's school change joins")
		assert.Empty(t, month.billedChildren, name)
	}
}

// A namesake of another family whose invoice bills the month stops a school
// change (point 5 of the Nachtrag Schulwechsel), also when the chain counts
// his issued contract to a running contract of his record that spells him
// differently. Noah's withdrawn contract at Birkenfeld has its invoice, his
// contract at Ispringen starts on the 15th. With the namesake nobody joins,
// so the contract at Ispringen is its child's entry and bills 60,00 €. The
// namesake was overlooked, Noah joined and the contract was held: 0,00 €.
func TestCareSchoolChangeCountsABilledNamesakeOfARunningRecord(t *testing.T) {
	t.Parallel()
	const (
		withdrawnContract = contractLea + 10
		namesakeContract  = contractLea + 20
		namesakeRunning   = contractLea + 21
		namesakeRecord    = 9700
		otherSchool       = schoolBirkenfeld + 1
	)
	_, leaves, enters := billedTable(t)
	withdrawn := leaves
	withdrawn.contract = withdrawnContract
	// The running contract of the namesake's record has his first name
	// corrected; his issued contract still names him Noah.
	running := identityContract{contract: namesakeRunning, school: schoolIspringen, student: namesakeRecord, from: billingMonth,
		until: "2027-01-31", first: "Noa", last: "Beispiel", birth: noahBirth, email: familyOther,
		booked: []parentbilling.CareContractService{mon1400}}
	billedNamesake := noahAt(namesakeContract, otherSchool, namesakeRecord, billingMonth, "2027-01-31", mon1400)
	billedNamesake.email = familyOther
	in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, nil, enters, running)
	in.invoiced[withdrawnContract] = issuedFor(t, withdrawn, "R-2027-0003", 4500, billingMonth, "2027-01-31")
	in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
	in.invoiced[namesakeContract] = issuedFor(t, billedNamesake, "R-2027-0004", 4000, billingMonth, "2027-01-31")
	in.issuedChildren[namesakeContract] = noahIdentity(t, namesakeRecord)
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Equal(t, int64(6000), draftTotals(month)[contractLea], "nobody joins: the contract at Ispringen bills its child's month")
	assert.Empty(t, month.joined)
	assert.NotContains(t, heldContractsOf(month.billedChildren), int64(contractLea))
}

// A notice run computes the contracts of its notices again. Such a contract
// counts as not yet issued for a school change, so a child an issued invoice
// already bills is held in the notice run too and keeps its assessment
// (S11). Noah's withdrawn contract at Birkenfeld has its invoice, 45,00 €;
// his contract at Ispringen, from the 15th, has a Jahresbescheid the run
// computes again. Its frozen family made it a second part with an invoice:
// nothing joined, and the run assessed it for the whole month, 60,00 €.
func TestCareNoticeMonthHoldsARecomputedContractAnInvoiceBills(t *testing.T) {
	t.Parallel()
	const withdrawnContract = contractLea + 10
	_, leaves, enters := billedTable(t)
	withdrawn := leaves
	withdrawn.contract = withdrawnContract
	in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, nil, enters)
	in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
	assessed := issuedFor(t, enters, "B-2027-0005", 6000, billingMonth, "2027-01-31")
	assessed.ID, assessed.Number, assessed.DocumentKind = 0, "B-2027-0005", parentbilling.DocumentKindFeeNotice
	invoiced := map[int64]parentbilling.CareInvoice{
		withdrawnContract: issuedFor(t, withdrawn, "R-2027-0003", 4500, billingMonth, "2027-01-31"),
		contractLea:       assessed,
	}
	review, final, err := computeNoticeMonth(in, invoiced, map[int64]bool{contractLea: true}, []int64{schoolBirkenfeld, schoolIspringen})
	require.NoError(t, err)
	assert.Equal(t, []int64{contractLea}, heldContractsOf(review.billedChildren), "the review names Noah")
	assert.Len(t, review.joined, 1, "and that his name joined the two records")
	assert.Empty(t, draftTotals(final), "the run assesses the month for no contract of his again")
	assert.True(t, heldOrUnpriced(&review.careMonth)[contractLea], "the held contract keeps the assessment of its notice")
}

// "Would bill" means an invoice with care positions today (S3): a contract
// with a booked weekday without a price stays under "Ohne Preis" and holds
// nobody back. Pro rata, one record: the invoice of the contract at
// Ispringen billed the whole month, its contract now begins on the 15th. The
// contract for the 1st to the 14th has no price. A third one bills the 15th
// to the 31st at Birkenfeld, 45,00 € * 17/31 = 24,68 €, on days no stale
// invoice bills: it is billed.
func TestCareMonthAContractWithoutAPriceHoldsNobodyBack(t *testing.T) {
	t.Parallel()
	const laterContract = contractLea + 10
	unpriced := booked("mon", 999, "Ohne Preis", "16:00")
	early := noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-14", unpriced)
	issued := noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630)
	later := noahAt(laterContract, schoolBirkenfeld, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1400)
	in := billedMonth(t, parentbilling.MonthRuleProRata, nil, early, issued, later)
	in.invoiced[contractLea] = issuedFor(t, issued, "R-2027-0007", 6000, billingMonth, "2027-01-31")
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{laterContract: 2468}, draftTotals(month))
	require.Len(t, month.unpriced, 1, "the contract without a price stays under Ohne Preis")
	assert.Equal(t, ident.ID(contractNoah), month.unpriced[0].ContractID)
	assert.Empty(t, month.billedChildren)
}

// asNotice turns the invoice of the fixture into a month of a Jahresbescheid.
func asNotice(invoice parentbilling.CareInvoice, number string) parentbilling.CareInvoice {
	invoice.ID, invoice.Number, invoice.DocumentKind = 0, number, parentbilling.DocumentKindFeeNotice
	for i := range invoice.BilledBy {
		invoice.BilledBy[i].Source, invoice.BilledBy[i].Number = parentbilling.BilledByNoticeRun, number
		invoice.BilledBy[i].DocumentKind = parentbilling.DocumentKindFeeNotice
	}
	return invoice
}

// The first computation of a notice month decides who is held; the second
// one, which takes a contract's old assessment back as issued, only adopts
// that (review round 2 of #7938). An assessment taken back for a missing
// price is stale on the days its contract no longer runs, and the second
// computation held the child for it: the run then took the sibling
// contract's month back to nothing while the review named nobody.
func TestCareNoticeMonthSecondComputationHoldsNobodyNew(t *testing.T) {
	t.Parallel()
	unpriced := booked("mon", 999, "Ohne Preis", "16:00")
	schools := []int64{schoolBirkenfeld, schoolIspringen}
	cases := []struct {
		name      string
		contracts []identityContract
		noticed   map[int64]bool
		// assessed is the notice month of contractNoah the run keeps.
		assessed int64
		totals   map[int64]int64
	}{
		{
			// Both contracts have a notice the run computes again. The one
			// without a price ran the whole month when it was assessed,
			// 45,00 €, and runs from the 15th today. The other one bills the
			// whole month, 45,00 €, as before.
			name: "the priced contract of the whole month keeps its draft",
			contracts: []identityContract{
				noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", unpriced),
				noahAt(contractLea, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-31", mon1400),
			},
			noticed: map[int64]bool{contractNoah: true, contractLea: true}, assessed: 4500,
			totals: map[int64]int64{contractLea: 4500},
		},
		{
			// The contract without a price runs the 1st to the 14th today;
			// its notice assessed the whole month, 40,00 €. The new contract
			// bills the 15th to the 31st: 60,00 € * 17/31 = 32,90 €.
			name: "the new contract for the rest of the month keeps its draft",
			contracts: []identityContract{
				noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-14", unpriced),
				noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630),
			},
			noticed: map[int64]bool{contractNoah: true}, assessed: 4000,
			totals: map[int64]int64{contractLea: 3290},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in := billedMonth(t, parentbilling.MonthRuleProRata, nil, tc.contracts...)
			invoiced := map[int64]parentbilling.CareInvoice{
				contractNoah: asNotice(issuedFor(t, tc.contracts[0], "", tc.assessed, billingMonth, "2027-01-31"), "B-2027-0006"),
			}
			if tc.noticed[contractLea] {
				invoiced[contractLea] = asNotice(issuedFor(t, tc.contracts[1], "", 4500, billingMonth, "2027-01-31"), "B-2027-0007")
			}
			review, final, err := computeNoticeMonth(in, invoiced, tc.noticed, schools)
			require.NoError(t, err)
			require.Len(t, review.unpriced, 1, "the contract without a price keeps its assessment")
			assert.Empty(t, review.billedChildren, "the review holds nobody")
			assert.Equal(t, tc.totals, draftTotals(final), "so the run assesses what the review showed")
		})
	}
}

// Only a contract without an invoice triggers a hold (S3); a contract whose
// invoice carries only the Mensa is named for that invoice (S5). Pro rata,
// one record: the withdrawn contract billed the 1st to the 14th, 40,00 € *
// 14/31 = 18,06 €. A second contract has an invoice with only the Mensa and
// would bill care from the 5th, a third one bills the 15th to the 31st,
// 32,90 €, on days no stale invoice bills. The Mensa contract held the whole
// child: the third contract was not billed, and the review named the child
// as billed, without the invoice to cancel.
func TestCareMonthAMealOnlyInvoiceHoldsNoOtherContract(t *testing.T) {
	t.Parallel()
	const withdrawnContract = contractLea + 10
	withdrawn := noahAt(withdrawnContract, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	later := noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630)
	// Until the 14th the Mensa contract bills only days the withdrawn
	// contract's invoice bills; until the 20th also days nobody bills.
	for _, until := range []string{"2027-01-14", "2027-01-20"} {
		t.Run("care until "+until, func(t *testing.T) {
			t.Parallel()
			mealOnly := noahAt(contractNoah, schoolIspringen, noahBirkenfeldRecord, "2027-01-05", until, tue1400)
			in := billedMonth(t, parentbilling.MonthRuleProRata, nil, mealOnly, later)
			in.invoiced[withdrawnContract] = issuedFor(t, withdrawn, "R-2027-0003", 1806, billingMonth, "2027-01-14")
			in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
			in.invoiced[contractNoah] = issuedFor(t, mealOnly, "R-2027-0008", 0, "", "")
			month, err := buildCareMonth(in)
			require.NoError(t, err)
			assert.Equal(t, map[int64]int64{contractLea: 3290}, draftTotals(month), "the contract for the rest of the month is billed")
			require.Len(t, month.billedChildren, 1)
			assert.Equal(t, parentbilling.HoldReasonMealOnlyInvoice, month.billedChildren[0].Reason)
			assert.Equal(t, []int64{contractNoah}, heldContractsOf(month.billedChildren))
			assert.Equal(t, in.invoiced[contractNoah].BilledBy, month.billedChildren[0].Invoices, "the Mensa invoice to cancel")
		})
	}
}

// Once the office cancelled the invoice with only the Mensa, its contract
// has none: it would bill the 5th to the 14th, which the withdrawn
// contract's invoice bills already, so the child is held as a whole (S3, S4)
// and nobody bills those days twice.
func TestCareMonthHoldsTheChildOnceItsMealOnlyInvoiceIsCancelled(t *testing.T) {
	t.Parallel()
	const withdrawnContract = contractLea + 10
	withdrawn := noahAt(withdrawnContract, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	cancelled := noahAt(contractNoah, schoolIspringen, noahBirkenfeldRecord, "2027-01-05", "2027-01-14", tue1400)
	later := noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630)
	in := billedMonth(t, parentbilling.MonthRuleProRata, nil, cancelled, later)
	in.invoiced[withdrawnContract] = issuedFor(t, withdrawn, "R-2027-0003", 1806, billingMonth, "2027-01-14")
	in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Empty(t, draftTotals(month))
	require.Len(t, month.billedChildren, 1)
	assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, month.billedChildren[0].Reason)
	assert.Equal(t, []int64{contractNoah, contractLea}, heldContractsOf(month.billedChildren))
	assert.Equal(t, in.invoiced[withdrawnContract].BilledBy, month.billedChildren[0].Invoices)
}

// A duplicate (E3) holds the contracts of its child in force; another
// contract the sibling chain counts to the same child is still held for an
// issued invoice (S3). Two running contracts of one record spell the child
// "Noa" and bill Monday twice. The withdrawn contract of that record, with
// its invoice of 40,00 €, names him "Noah", so the chain counts a running
// contract without a record of that name to him too. That one was billed
// another 40,00 €.
func TestCareMonthADuplicateDoesNotFreeAnotherContractOfTheBilledChild(t *testing.T) {
	t.Parallel()
	const (
		withdrawnContract = contractLea + 10
		unlinkedContract  = contractLea + 11
	)
	noa := func(contract int64) identityContract {
		twice := noahAt(contract, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-31", mon1400)
		twice.first = "Noa"
		return twice
	}
	unlinked := noahAt(unlinkedContract, schoolIspringen, 0, billingMonth, "2027-01-31", mon1400)
	withdrawn := noahAt(withdrawnContract, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-31", mon1400)
	in := billedMonth(t, parentbilling.MonthRuleVersionOnFirst, nil, noa(contractNoah), noa(contractLea), unlinked)
	in.invoiced[withdrawnContract] = issuedFor(t, withdrawn, "R-2027-0003", 4000, billingMonth, "2027-01-31")
	in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Empty(t, draftTotals(month), "the month has its invoice: no contract of the child bills it again")
	assert.Equal(t, []int64{contractNoah, contractLea}, heldContracts(month.duplicates), "the duplicate stays under its own heading")
	assert.Equal(t, []int64{unlinkedContract}, heldContractsOf(month.billedChildren), "the other contract is held for the invoice")
}

// The review names the invoices in the way of the held contracts, not every
// stale invoice of the child (S8). Pro rata, one record: two withdrawn
// contracts billed the 1st to the 14th and the 15th to the 31st. The running
// contract bills from the 15th: only the second invoice is in its way.
func TestCareMonthNamesOnlyTheInvoicesInTheWay(t *testing.T) {
	t.Parallel()
	const (
		firstHalf  = contractLea + 10
		secondHalf = contractLea + 11
	)
	early := noahAt(firstHalf, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	late := noahAt(secondHalf, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1400)
	running := noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630)
	in := billedMonth(t, parentbilling.MonthRuleProRata, nil, running)
	in.invoiced[firstHalf] = issuedFor(t, early, "R-2027-0003", 1806, billingMonth, "2027-01-14")
	in.invoiced[secondHalf] = issuedFor(t, late, "R-2027-0004", 2194, "2027-01-15", "2027-01-31")
	in.issuedChildren[firstHalf] = noahIdentity(t, noahBirkenfeldRecord)
	in.issuedChildren[secondHalf] = noahIdentity(t, noahBirkenfeldRecord)
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	require.Len(t, month.billedChildren, 1)
	assert.Equal(t, in.invoiced[secondHalf].BilledBy, month.billedChildren[0].Invoices)
}

// A notice run names a child once, however many months hold it: the
// invoices of every month stand on its one entry (S8).
func TestCareNoticePreviewNamesAHeldChildOnce(t *testing.T) {
	t.Parallel()
	contracts := []parentbilling.CareDuplicateContract{{ContractID: ident.ID(contractLea), SchoolID: ident.ID(schoolIspringen)}}
	entry := func(reason, number string) parentbilling.CareBilledChild {
		return parentbilling.CareBilledChild{ChildFirstName: "Noah", ChildLastName: "Beispiel", Reason: reason, Contracts: contracts,
			Invoices: []parentbilling.CareBilledInvoice{{Source: parentbilling.BilledByCareRun, ContractID: ident.ID(contractNoah), Number: number}}}
	}
	january := []parentbilling.CareBilledChild{entry(parentbilling.HoldReasonAlreadyBilled, "R-2027-0003")}
	february := []parentbilling.CareBilledChild{entry(parentbilling.HoldReasonAlreadyBilled, "R-2027-0011"),
		entry(parentbilling.HoldReasonMealOnlyInvoice, "R-2027-0012")}
	// In March a second contract of the child is in force too.
	march := []parentbilling.CareBilledChild{entry(parentbilling.HoldReasonAlreadyBilled, "R-2027-0013")}
	march[0].Contracts = append(slices.Clone(contracts), parentbilling.CareDuplicateContract{ContractID: ident.ID(contractNoah)})
	merged := mergeBilledChildren(mergeBilledChildren(mergeBilledChildren(mergeBilledChildren(nil, january), february), january), march)
	require.Len(t, merged, 2, "one entry per child and reason")
	assert.Equal(t, []string{"R-2027-0003", "R-2027-0011", "R-2027-0013"},
		[]string{merged[0].Invoices[0].Number, merged[0].Invoices[1].Number, merged[0].Invoices[2].Number})
	assert.Equal(t, []int64{contractLea, contractNoah}, heldContractsOf(merged[:1]), "with the contracts of every month")
	assert.Equal(t, parentbilling.HoldReasonMealOnlyInvoice, merged[1].Reason)
	assert.Len(t, january[0].Invoices, 1, "the months keep their own entries")
}

// A held child and a contract of it whose invoice carries only the Mensa
// stand in two entries, each with its own reason and documents: the office
// checks the one and cancels the other (S5). Pro rata, one record: the
// withdrawn contract billed the 1st to the 14th, a running contract would
// bill those days again, and a third one with a Mensa invoice would bill the
// 15th to the 31st.
func TestCareMonthNamesAHeldChildAndItsMealOnlyInvoiceApart(t *testing.T) {
	t.Parallel()
	const withdrawnContract = contractLea + 10
	withdrawn := noahAt(withdrawnContract, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	again := noahAt(contractNoah, schoolIspringen, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	mealOnly := noahAt(contractLea, schoolIspringen, noahBirkenfeldRecord, "2027-01-15", "2027-01-31", mon1630)
	in := billedMonth(t, parentbilling.MonthRuleProRata, nil, again, mealOnly)
	in.invoiced[withdrawnContract] = issuedFor(t, withdrawn, "R-2027-0003", 1806, billingMonth, "2027-01-14")
	in.issuedChildren[withdrawnContract] = noahIdentity(t, noahBirkenfeldRecord)
	in.invoiced[contractLea] = issuedFor(t, mealOnly, "R-2027-0008", 0, "", "")
	month, err := buildCareMonth(in)
	require.NoError(t, err)
	assert.Empty(t, draftTotals(month))
	require.Len(t, month.billedChildren, 2)
	held, open := month.billedChildren[0], month.billedChildren[1]
	assert.Equal(t, parentbilling.HoldReasonAlreadyBilled, held.Reason)
	assert.Equal(t, []int64{contractNoah}, heldContractsOf(month.billedChildren[:1]))
	assert.Equal(t, in.invoiced[withdrawnContract].BilledBy, held.Invoices, "no Mensa invoice under the month that is billed")
	assert.Equal(t, parentbilling.HoldReasonMealOnlyInvoice, open.Reason)
	assert.Equal(t, []int64{contractLea}, heldContractsOf(month.billedChildren[1:]))
	assert.Equal(t, in.invoiced[contractLea].BilledBy, open.Invoices)
}
