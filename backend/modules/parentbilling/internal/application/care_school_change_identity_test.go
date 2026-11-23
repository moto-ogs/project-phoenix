package application

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// A child changes its school within the month and has a record at each
// school (#7874, ADR 0158 Nachtrag Schulwechsel). Records belong to one
// school, so moto sees two records; the same family, name and date of birth
// on contracts that run one after the other make them one child. Setup and
// prices as in TestCareMonthSchoolChangeWithinMonthCounts: Mia books
// 80,00 € at Ispringen all month, the rule is half off from the 2nd child at
// Ispringen; Noah leaves Birkenfeld on the 14th (45,00 € a month) and starts
// at Ispringen on the 15th (60,00 € a month).

// identityContract is one contract of the table: its school, days and child.
type identityContract struct {
	contract    int64
	school      int64
	student     int64
	from, until string
	first, last string
	birth       string
	email       string
	booked      []parentbilling.CareContractService
}

// schoolNames are the names of the schools of the table.
var schoolNames = map[int64]string{schoolIspringen: "Grundschule Ispringen", schoolBirkenfeld: "Grundschule Birkenfeld"}

const (
	noahBirkenfeldRecord int64 = 9601
	noahIspringenRecord  int64 = 9602
	noahBirth                  = "2018-03-04"
)

func noahAt(contract, school, student int64, from, until string, booked ...parentbilling.CareContractService) identityContract {
	return identityContract{contract: contract, school: school, student: student, from: from, until: until,
		first: "Noah", last: "Beispiel", birth: noahBirth, email: familyEva, booked: booked}
}

func TestCareMonthCountsAChildWithARecordAtEachSchoolOnce(t *testing.T) {
	t.Parallel()
	mia := identityContract{contract: contractMia, school: schoolIspringen, student: 9501, from: billingMonth, until: "2027-01-31",
		first: "Mia", last: "Beispiel", birth: "2016-05-06", email: familyEva, booked: []parentbilling.CareContractService{mon1400, tue1400}}
	leaves := noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-14", mon1400)
	enters := noahAt(contractLea, schoolIspringen, noahIspringenRecord, "2027-01-15", "2027-01-31", mon1630)
	with := func(base identityContract, change func(*identityContract)) identityContract {
		change(&base)
		return base
	}
	cases := []struct {
		name      string
		monthRule string
		contracts []identityContract
		totals    map[int64]int64
		// countBoth makes Birkenfeld count for the rule too; from is the
		// family size the rule reduces from, 2 without one.
		countBoth bool
		from      int
		// freeAt is a school whose price list makes January free.
		freeAt int64
		// children is the size of the family Mia's sibling reduction names,
		// zero when she gets none.
		children int
		joined   bool
	}{
		{
			// The contract at Ispringen bills nothing in January (E2): Noah
			// had a contract on the 1st. The family has two children: Mia
			// pays 40,00 €, Noah's month is Birkenfeld's, 45,00 €.
			name: "full month: one invoice for the child, counted once", contracts: []identityContract{mia, leaves, enters},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500}, children: 2, joined: true,
		},
		{
			// Pro rata each contract bills its own days, as before; the
			// family still has two children, not three. Birkenfeld 14 of
			// 31 days: 20,32 €; Ispringen 17 days of 60,00 € half off:
			// 16,45 €.
			name: "pro rata: counted once", monthRule: parentbilling.MonthRuleProRata, contracts: []identityContract{mia, leaves, enters},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 2032, contractLea: 1645}, children: 2, joined: true,
		},
		{
			// Both schools count and the rule reduces from three children:
			// Mia and Noah are two, so nobody pays less. Counting Noah's
			// records as two children made it three and took 40,00 € off
			// Mia and 30,00 € off a second invoice of Noah.
			name: "both schools count: the child is not a second sibling", contracts: []identityContract{mia, leaves, enters},
			countBoth: true, from: 3, totals: map[int64]int64{contractMia: 8000, contractNoah: 4500}, joined: true,
		},
		{
			// Pro rata as above: Ispringen 17 of 31 days of 60,00 € is
			// 32,90 € without a reduction.
			name: "both schools count, pro rata: the child is not a second sibling", monthRule: parentbilling.MonthRuleProRata,
			contracts: []identityContract{mia, leaves, enters}, countBoth: true, from: 3,
			totals: map[int64]int64{contractMia: 8000, contractNoah: 2032, contractLea: 3290}, joined: true,
		},
		{
			// January is free at Birkenfeld. Under the full month the
			// contract that holds on the 1st bills the month (E2): Noah pays
			// nothing in January, as with one record. His contract at
			// Ispringen still counts him there: Mia pays 40,00 €.
			name: "a free month at the old school frees the child's month", contracts: []identityContract{mia, leaves, enters},
			freeAt: schoolBirkenfeld, totals: map[int64]int64{contractMia: 4000}, children: 2, joined: true,
		},
		{
			// The names differ in spelling only: an umlaut written out at
			// one school, decomposed (as macOS pastes it) at the other, and
			// other case and spaces.
			name: "spelling of the name does not matter", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.first, c.last = "Jonas", "Müller" }),
				with(enters, func(c *identityContract) { c.first, c.last = " jonas ", "Müller" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500}, children: 2, joined: true,
		},
		{
			name: "umlaut written out is the same name", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.first, c.last = "Jonas", "Müller" }),
				with(enters, func(c *identityContract) { c.first, c.last = "Jonas", "Mueller" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500}, children: 2, joined: true,
		},
		{
			// Both contracts run all month: two children (twins with one
			// name), as before. Each bills its month and the family has
			// three children with a contract.
			name: "contracts at the same time stay two children", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.until = "2027-01-31" }),
				with(enters, func(c *identityContract) { c.from = billingMonth })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000}, children: 2,
		},
		{
			name: "another family stays another child", contracts: []identityContract{mia, leaves,
				with(enters, func(c *identityContract) { c.email = familyOther })},
			totals: map[int64]int64{contractMia: 8000, contractNoah: 4500, contractLea: 6000},
		},
		{
			name: "another date of birth stays another child", contracts: []identityContract{mia, leaves,
				with(enters, func(c *identityContract) { c.birth = "2018-03-05" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000}, children: 2,
		},
		{
			name: "without a date of birth the records decide", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.birth = "" }),
				with(enters, func(c *identityContract) { c.birth = "" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000}, children: 2,
		},
		{
			// Two records of one name at Birkenfeld until the 14th: which
			// of them moved to Ispringen is not clear, so moto joins none.
			name: "two candidates join none", contracts: []identityContract{mia, leaves,
				with(leaves, func(c *identityContract) { c.contract, c.student = contractLea+1, noahBirkenfeldRecord+10 }),
				enters},
			totals:   map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea + 1: 4500, contractLea: 3000},
			children: 2,
		},
		{
			// The same with the new school first: the pair that could join
			// comes first, and still none joins.
			name: "two candidates join none, whatever the order", contracts: []identityContract{mia, enters, leaves,
				with(leaves, func(c *identityContract) { c.contract, c.student = contractLea+1, noahBirkenfeldRecord+10 })},
			totals:   map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea + 1: 4500, contractLea: 3000},
			children: 2,
		},
		{
			// A child of that name and date of birth in another family
			// could be the one that moved: nobody joins.
			name: "a namesake of another family stops the join", contracts: []identityContract{mia, leaves, enters,
				with(leaves, func(c *identityContract) {
					c.contract, c.student, c.email = contractLea+2, noahBirkenfeldRecord+20, familyOther
				})},
			totals:   map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000, contractLea + 2: 4500},
			children: 2,
		},
		{
			name: "a namesake without a date of birth stops the join", contracts: []identityContract{mia, leaves, enters,
				with(leaves, func(c *identityContract) {
					c.contract, c.student, c.email, c.birth = contractLea+2, noahBirkenfeldRecord+20, familyOther, ""
				})},
			totals:   map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000, contractLea + 2: 4500},
			children: 2,
		},
		{
			// The parts of a name stay apart: „Lia|Marie Müller“ is not
			// „Lia Marie|Müller“.
			name: "a name split differently is another name", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.first, c.last = "Lia|Marie", "Müller" }),
				with(enters, func(c *identityContract) { c.first, c.last = "Lia", "Marie|Müller" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000}, children: 2,
		},
		{
			// A control character in a name stays part of it.
			name: "a separator inside a name does not join", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.first, c.last = "Anna\x1fMaria", "Meyer" }),
				with(enters, func(c *identityContract) { c.first, c.last = "Anna", "Maria\x1fMeyer" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000}, children: 2,
		},
		{
			// Without records the name decides as E1 has it; the school
			// change adds nothing to it.
			name: "without records E1 decides", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) { c.student, c.first, c.last = 0, "Anna", "Müller" }),
				with(enters, func(c *identityContract) { c.student, c.first, c.last = 0, "Anna", "Mueller" })},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 4500, contractLea: 3000}, children: 2,
		},
		{
			// Within one school the record decides: a second record there
			// is a second child, as before.
			name: "two records at one school stay two children", contracts: []identityContract{mia,
				with(leaves, func(c *identityContract) {
					c.school = schoolIspringen
					c.booked = []parentbilling.CareContractService{mon1630}
				}),
				enters},
			totals: map[int64]int64{contractMia: 4000, contractNoah: 3000, contractLea: 3000}, children: 3,
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
				invoiced: map[int64]parentbilling.CareInvoice{}, recipients: map[int64]parentbilling.CareRecipient{},
				rules: identityRules(t, tc.from, tc.countBoth)}
			if tc.freeAt != 0 {
				in.lists = []parentbilling.CarePriceListHead{{SchoolID: ident.ID(tc.freeAt), ValidFrom: day(t, "2026-09-01"), FreeMonths: []int{1}}}
			}
			for _, contract := range tc.contracts {
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
			month, err := buildCareMonth(in)
			require.NoError(t, err)
			// A notice run computes the months the same way and names the
			// joined child too, so the office sees it there as well.
			notice, _, err := computeNoticeMonth(in, in.invoiced, nil, []int64{schoolIspringen, schoolBirkenfeld})
			require.NoError(t, err)
			assert.Equal(t, month.joined, notice.joined, "the notice preview names the same joined children")
			assert.Empty(t, month.duplicates, "contracts one after the other are no duplicate")
			assert.Empty(t, month.unpriced)
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
			assert.Equal(t, tc.totals, totals)
			if tc.children == 0 {
				assert.Empty(t, miaSibling, "Mia gets no sibling reduction")
				assertJoined(t, month, tc.joined)
				return
			}
			require.Len(t, miaSibling, 1)
			assert.Equal(t, tc.children, *miaSibling[0].FamilyChildren, "children of the family")
			assertJoined(t, month, tc.joined)
		})
	}
}

// identityRules is the family size rule of the table: half off at
// Ispringen from the from-th child, 2 without one; with countBoth the
// children at Birkenfeld count too.
func identityRules(t *testing.T, from int, countBoth bool) []parentbilling.ContributionRule {
	t.Helper()
	if from == 0 {
		from = 2
	}
	rules := familySizeRule(false, from)(t)
	if countBoth {
		rules[0].CountSchoolIDs = ident.IDs([]int64{schoolBirkenfeld})
	}
	return rules
}

// assertJoined checks that the month names Noah as joined by his name, with
// both contracts and their schools, exactly when the case joins him.
func assertJoined(t *testing.T, month careMonth, joined bool) {
	t.Helper()
	if !joined {
		assert.Empty(t, month.joined, "no child joined by its name")
		return
	}
	require.Len(t, month.joined, 1)
	assert.Equal(t, []parentbilling.CareDuplicateContract{
		{ContractID: ident.ID(contractNoah), SchoolID: ident.ID(schoolBirkenfeld), SchoolName: "Grundschule Birkenfeld"},
		{ContractID: ident.ID(contractLea), SchoolID: ident.ID(schoolIspringen), SchoolName: "Grundschule Ispringen"},
	}, month.joined[0].Contracts, "both contracts, in the order they begin")
	// A run of one of the two schools names him; a run of neither does not.
	assert.Len(t, narrowMonth(month, []int64{schoolBirkenfeld}, nil).joined, 1)
	assert.Empty(t, narrowMonth(month, []int64{schoolBirkenfeld + 100}, nil).joined)
}

// A school change joins two children of one family; every other child
// keeps its place and so its key in the sibling chain, so a tie between
// twins of another family keeps its order (#7874).
func TestCareChildKeysDoNotDependOnOtherFamilies(t *testing.T) {
	t.Parallel()
	twin := func(contract, student int64, first string) parentbilling.CareContractVersion {
		version := sjrVersion(t, contract, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
		version.StudentID, version.ChildFirstName, version.ChildBirthDate = ptr(student), first, ptr(day(t, "2017-02-03"))
		return version
	}
	moved := []parentbilling.CareContractVersion{
		sjrVersion(t, 101, schoolBirkenfeld, 1, billingMonth, "2027-01-14", mon1400),
		sjrVersion(t, 102, schoolIspringen, 1, "2027-01-15", "2027-01-31", mon1400),
	}
	for i := range moved {
		moved[i].ChildFirstName, moved[i].ChildBirthDate = "Noah", ptr(day(t, noahBirth))
	}
	byContract, order := versionsByContract(append(moved, twin(910, 9910, "Ida"), twin(911, 9911, "Ole")))
	keysWith := func(second string) map[int64]string {
		recipients := map[int64]parentbilling.CareRecipient{101: {Email: familyEva}, 102: {Email: second}}
		return childKeys(byContract, order, nil, contractFamilies(byContract, recipients))
	}
	apart, joined := keysWith(familyOther), keysWith(familyEva)
	require.NotEqual(t, apart[101], apart[102], "two families: two children")
	require.Equal(t, joined[101], joined[102], "one family: the school change is one child")
	assert.Equal(t, apart[101], joined[101], "the joined child keeps the place of its first part")
	assert.Equal(t, apart[910], joined[910])
	assert.Equal(t, apart[911], joined[911])
}

// The read of a run records every contract its review shows, including
// those of a child joined across schools (#7874).
func TestRunReadsRecordTheContractsOfAJoinedChild(t *testing.T) {
	t.Parallel()
	joined := []parentbilling.CareJoinedChild{{Contracts: []parentbilling.CareDuplicateContract{
		{ContractID: ident.ID(contractNoah)}, {ContractID: ident.ID(contractLea)},
	}}}
	monthly := parentbilling.CareRunDetail{Invoices: []parentbilling.CareInvoice{{ContractID: ident.ID(contractNoah)}}, JoinedChildren: joined}
	assert.Equal(t, []int64{contractNoah, contractLea}, shownContracts(monthly))
	notice := parentbilling.CareNoticeRunDetail{Notices: []parentbilling.CareNotice{{ContractID: ident.ID(contractMia)}}, JoinedChildren: joined}
	assert.Equal(t, []int64{contractMia, contractNoah, contractLea}, shownNoticeContracts(notice))
}

// Without a school change the sibling chain keys the children as before
// #7874: by their place in E1, so a tie between twins keeps the order a
// run of the month already issued with.
func TestCareChildKeysKeepThePlacesOfE1(t *testing.T) {
	t.Parallel()
	var versions []parentbilling.CareContractVersion
	for i := int64(0); i < 11; i++ {
		version := sjrVersion(t, 600+i, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
		version.ChildFirstName = "Kind " + strconv.FormatInt(i, 10)
		versions = append(versions, version)
	}
	byContract, order := versionsByContract(versions)
	keys := childKeys(byContract, order, nil, contractFamilies(byContract, nil))
	for i, contractID := range order {
		assert.Equal(t, "child:"+strconv.Itoa(i), keys[contractID])
	}
}

// The sibling chain keys the children as E1 does over the contracts in
// force and the issued ones together (#7863): an issued namesake in one
// family leaves the keys of twins in another family as they were, and so
// their order against invoices already issued (#7874).
func TestCareChildKeysKeepThePlacesOfE1WithIssuedNamesakes(t *testing.T) {
	t.Parallel()
	noah := func(contract int64, student *int64) parentbilling.CareContractVersion {
		version := sjrVersion(t, contract, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
		version.StudentID, version.ChildFirstName, version.ChildBirthDate = student, "Noah", ptr(day(t, noahBirth))
		return version
	}
	twin := func(contract, student int64, first string) parentbilling.CareContractVersion {
		version := sjrVersion(t, contract, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
		version.StudentID, version.ChildFirstName, version.ChildBirthDate = ptr(student), first, ptr(day(t, "2017-02-03"))
		return version
	}
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{
		noah(700, ptr(int64(9700))), noah(701, nil), twin(702, 9702, "Ida"), twin(703, 9703, "Ole"),
	})
	issued := map[int64]parentbilling.CareContractChild{799: {StudentID: ptr(int64(9799)), FirstName: "Noah", LastName: "Beispiel",
		BirthDate: ptr(day(t, noahBirth))}}
	keys := childKeys(byContract, order, issued, contractFamilies(byContract, nil))
	// E1 over both, as before #7874: Noah's record 0, Noah without a record
	// 1 (the issued second record makes the name ambiguous), Ida 2, Ole 3.
	assert.Equal(t, "child:0", keys[700])
	assert.Equal(t, "child:1", keys[701])
	assert.Equal(t, "child:2", keys[702])
	assert.Equal(t, "child:3", keys[703])
	assert.Equal(t, "contract:799", keys[799])
}

// A school change joins only where the sibling chain sees each part as a
// child of its own: here an issued contract spells Benjamin's record „Ben“,
// so the chain counts the Ben without a record at the new school with him.
// Nothing joins, in neither grouping, and the month bills as before (#7874).
func TestCareSchoolChangeJoinsOnlyWhereTheChainAgrees(t *testing.T) {
	t.Parallel()
	birth := ptr(day(t, noahBirth))
	version := func(contract, school int64, student *int64, first, from, until string) parentbilling.CareContractVersion {
		v := sjrVersion(t, contract, school, 1, from, until, mon1400)
		v.StudentID, v.ChildFirstName, v.ChildBirthDate = student, first, birth
		return v
	}
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{
		version(801, schoolBirkenfeld, ptr(int64(9801)), "Benjamin", billingMonth, "2027-01-14"),
		version(802, schoolIspringen, ptr(int64(9802)), "Benjamin", "2027-01-15", "2027-01-31"),
		version(803, schoolIspringen, nil, "Ben", billingMonth, "2027-01-31"),
	})
	recipients := map[int64]parentbilling.CareRecipient{801: {Email: familyEva}, 802: {Email: familyEva}, 803: {Email: familyOther}}
	families := contractFamilies(byContract, recipients)

	plain := groupCare(byContract, order, families, nil, nil)
	require.Len(t, plain.joined, 1, "without the issued spelling the school change joins")
	assert.Equal(t, plain.keys[801], plain.keys[802])

	issued := map[int64]parentbilling.CareContractChild{804: {StudentID: ptr(int64(9801)), FirstName: "Ben", LastName: "Beispiel", BirthDate: birth}}
	grouping := groupCare(byContract, order, families, issued, nil)
	assert.Empty(t, grouping.joined)
	assert.NotEqual(t, grouping.keys[801], grouping.keys[802])
	assert.Equal(t, chainKeys(byContract, chainChildren(byContract, order, issued)), grouping.keys, "the chain as before #7874")
}

// A school change joins only where every invoice already issued for a part
// froze the family of the change: an invoice of another family keeps its
// key, so its place among the children of that family stays (#7874).
func TestCareSchoolChangeKeepsTheKeysOfAnotherFamilysInvoices(t *testing.T) {
	t.Parallel()
	birth := ptr(day(t, noahBirth))
	version := func(contract, school, student int64, from, until string) parentbilling.CareContractVersion {
		v := sjrVersion(t, contract, school, 1, from, until, mon1400)
		v.StudentID, v.ChildFirstName, v.ChildBirthDate = ptr(student), "Noah", birth
		return v
	}
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{
		version(811, schoolBirkenfeld, 9811, billingMonth, "2027-01-14"),
		version(812, schoolIspringen, 9812, "2027-01-15", "2027-01-31"),
	})
	families := contractFamilies(byContract, map[int64]parentbilling.CareRecipient{811: {Email: familyEva}, 812: {Email: familyEva}})
	same := groupCare(byContract, order, families, nil, map[int64]string{811: parentbilling.FamilyKey(familyEva)})
	assert.Len(t, same.joined, 1, "an invoice of the same family joins")
	other := groupCare(byContract, order, families, nil, map[int64]string{811: parentbilling.FamilyKey(familyOther)})
	assert.Empty(t, other.joined, "an invoice of another family keeps the child apart")
	assert.Equal(t, chainKeys(byContract, chainChildren(byContract, order, nil)), other.keys)

	// The joined child keeps the key its issued invoice was ranked by, so
	// its order against its siblings' invoices stays.
	issuedLater := groupCare(byContract, order, families, nil, map[int64]string{812: parentbilling.FamilyKey(familyEva)})
	require.Len(t, issuedLater.joined, 1)
	assert.Equal(t, "child:1", issuedLater.keys[811])
	assert.Equal(t, "child:1", issuedLater.keys[812])
	both := groupCare(byContract, order, families, nil,
		map[int64]string{811: parentbilling.FamilyKey(familyEva), 812: parentbilling.FamilyKey(familyEva)})
	assert.Empty(t, both.joined, "two parts with an issued invoice each stay apart (#7892)")
}

// Both computations of a notice month decide a school change alike: a part
// whose notice froze another family stays apart in the first computation
// too, where its notice is computed again (#7874).
func TestCareNoticeMonthDecidesASchoolChangeOnce(t *testing.T) {
	t.Parallel()
	unpriced := booked("mon", 999, "Ohne Preis", "16:00")
	in := careMonthInput{month: day(t, billingMonth), rule: parentbilling.MonthRuleVersionOnFirst, tariffs: chainTariffs(t),
		recipients: map[int64]parentbilling.CareRecipient{contractNoah: {Email: familyEva}, contractLea: {Email: familyEva}}}
	for _, contract := range []identityContract{
		noahAt(contractNoah, schoolBirkenfeld, noahBirkenfeldRecord, billingMonth, "2027-01-14", unpriced),
		noahAt(contractLea, schoolIspringen, noahIspringenRecord, "2027-01-15", "2027-01-31", unpriced),
	} {
		version := sjrVersion(t, contract.contract, contract.school, 1, contract.from, contract.until, contract.booked...)
		version.StudentID, version.ChildFirstName, version.ChildBirthDate = ptr(contract.student), contract.first, ptr(day(t, contract.birth))
		in.versions = append(in.versions, version)
	}
	invoiced := map[int64]parentbilling.CareInvoice{contractNoah: {ContractID: ident.ID(contractNoah), SchoolID: ident.ID(schoolBirkenfeld),
		FamilyEmail: parentbilling.FamilyKey(familyOther), DocumentKind: parentbilling.DocumentKindFeeNotice,
		Positions: []parentbilling.CarePosition{{CareOfferingID: ident.ID(moduleUntil1400), AmountCents: 4500, PayableCents: 4500}}}}
	review, final, err := computeNoticeMonth(in, invoiced, map[int64]bool{contractNoah: true, contractLea: true}, []int64{schoolBirkenfeld, schoolIspringen})
	require.NoError(t, err)
	assert.Empty(t, review.joined, "the first computation keeps the parts apart")
	assert.Empty(t, final.joined)
	assert.Len(t, review.unpriced, 2, "both contracts lack a price, so both keep their assessment")
}

// The chain breaks a tie of price and date of birth by the key, and only a
// twin could tie with the joining child. A family with a twin of the child
// that changes its school keeps both apart, so no rank changes against an
// invoice already issued (#7874).
func TestCareSchoolChangeLeavesTwinsAsBefore(t *testing.T) {
	t.Parallel()
	birth := ptr(day(t, noahBirth))
	version := func(contract, school, student int64, first, from, until string) parentbilling.CareContractVersion {
		v := sjrVersion(t, contract, school, 1, from, until, mon1400)
		v.StudentID, v.ChildFirstName, v.ChildBirthDate = ptr(student), first, birth
		return v
	}
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{
		version(821, schoolBirkenfeld, 9821, "Noah", billingMonth, "2027-01-14"),
		version(822, schoolIspringen, 9822, "Noah", "2027-01-15", "2027-01-31"),
		version(823, schoolBirkenfeld, 9823, "Ida", billingMonth, "2027-01-31"),
	})
	recipients := map[int64]parentbilling.CareRecipient{821: {Email: familyEva}, 822: {Email: familyEva}, 823: {Email: familyOther}}
	apart := groupCare(byContract, order, contractFamilies(byContract, recipients), nil, nil)
	require.Len(t, apart.joined, 1, "a child of that birthday in another family does not stop the join")

	recipients[823] = parentbilling.CareRecipient{Email: familyEva}
	twins := groupCare(byContract, order, contractFamilies(byContract, recipients), nil, nil)
	assert.Empty(t, twins.joined)
	assert.Equal(t, chainKeys(byContract, chainChildren(byContract, order, nil)), twins.keys)

	// The twin counts as well when only an issued invoice names it.
	delete(recipients, 823)
	byContract, order = versionsByContract([]parentbilling.CareContractVersion{
		version(821, schoolBirkenfeld, 9821, "Noah", billingMonth, "2027-01-14"),
		version(822, schoolIspringen, 9822, "Noah", "2027-01-15", "2027-01-31"),
	})
	issued := map[int64]parentbilling.CareContractChild{824: {StudentID: ptr(int64(9824)), FirstName: "Ida", LastName: "Beispiel", BirthDate: birth}}
	issuedTwin := groupCare(byContract, order, contractFamilies(byContract, recipients), issued,
		map[int64]string{824: parentbilling.FamilyKey(familyEva)})
	assert.Empty(t, issuedTwin.joined)
}
