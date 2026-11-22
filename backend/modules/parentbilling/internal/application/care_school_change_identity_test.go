package application

import (
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
			for _, contract := range tc.contracts {
				version := sjrVersion(t, contract.contract, contract.school, 1, contract.from, contract.until, contract.booked...)
				version.StudentID = ptr(contract.student)
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
