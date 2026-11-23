package application

import (
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
