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
		return childKeys(byContract, childrenOf(byContract, order, contractFamilies(byContract, recipients)), nil)
	}
	apart, joined := keysWith(familyOther), keysWith(familyEva)
	require.NotEqual(t, apart[101], apart[102], "two families: two children")
	require.Equal(t, joined[101], joined[102], "one family: the school change is one child")
	assert.Equal(t, apart[101], joined[101], "the joined child keeps the place of its first part")
	assert.Equal(t, apart[910], joined[910])
	assert.Equal(t, apart[911], joined[911])
}

// A contract an issued invoice bills outside the versions in force joins a
// child; it never regroups the contracts in force. Here it carries a second
// record of the same name in another family: the contract without a record
// still belongs to the one record in force, as E2 groups it (#7874).
func TestCareIssuedIdentityDoesNotRegroupContractsInForce(t *testing.T) {
	t.Parallel()
	recorded := sjrVersion(t, 201, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
	unrecorded := sjrVersion(t, 202, schoolIspringen, 1, billingMonth, "2027-01-31", tue1400)
	unrecorded.StudentID = nil
	for _, version := range []*parentbilling.CareContractVersion{&recorded, &unrecorded} {
		version.ChildFirstName, version.ChildBirthDate = "Noah", ptr(day(t, noahBirth))
	}
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{recorded, unrecorded})
	families := contractFamilies(byContract, nil)
	issued := map[int64]parentbilling.CareContractChild{203: {StudentID: ptr(int64(9999)), FirstName: "Noah", LastName: "Beispiel",
		BirthDate: ptr(day(t, noahBirth))}}
	children := childrenOf(byContract, order, families)
	keys := childKeys(byContract, children, issued)
	require.Len(t, children, 1, "E2 groups both contracts in force as one child")
	assert.Equal(t, keys[201], keys[202], "the chain groups them the same way")
	assert.NotEqual(t, keys[201], keys[203], "the issued contract of another record stays apart")
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

// A contract an issued invoice bills outside the versions in force and
// without a record joins the child of the contracts in force without a
// record of its name and date of birth, as E1 groups them: the sibling
// chain counts that child once (#7874).
func TestCareIssuedContractWithoutRecordJoinsTheChildWithoutRecord(t *testing.T) {
	t.Parallel()
	inForce := sjrVersion(t, 301, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
	inForce.StudentID, inForce.ChildFirstName, inForce.ChildBirthDate = nil, "Noah", ptr(day(t, noahBirth))
	byContract, order := versionsByContract([]parentbilling.CareContractVersion{inForce})
	issued := map[int64]parentbilling.CareContractChild{302: {FirstName: "Noah", LastName: "Beispiel", BirthDate: ptr(day(t, noahBirth))}}
	keys := childKeys(byContract, childrenOf(byContract, order, contractFamilies(byContract, nil)), issued)
	assert.Equal(t, keys[301], keys[302])
}

// Contracts an issued invoice bills outside the versions in force join the
// children in force as E1 groups them (#7863, #7874), without regrouping
// the contracts in force.
func TestCareIssuedContractsJoinTheChildrenInForceAsE1Does(t *testing.T) {
	t.Parallel()
	birth := ptr(day(t, noahBirth))
	inForce := func(contract int64, student *int64, first string) parentbilling.CareContractVersion {
		version := sjrVersion(t, contract, schoolIspringen, 1, billingMonth, "2027-01-31", mon1400)
		version.StudentID, version.ChildFirstName, version.ChildBirthDate = student, first, birth
		return version
	}
	identity := func(student *int64, first string) parentbilling.CareContractChild {
		return parentbilling.CareContractChild{StudentID: student, FirstName: first, LastName: "Beispiel", BirthDate: birth}
	}
	cases := []struct {
		name     string
		inForce  []parentbilling.CareContractVersion
		issued   map[int64]parentbilling.CareContractChild
		same     [][]int64
		separate [][2]int64
	}{
		{
			// The record in force is spelled „Benjamin“, the issued contract
			// of that record „Ben“: a contract „Ben“ without a record joins
			// that record.
			name:    "a known record lends the name its issued contract spells",
			inForce: []parentbilling.CareContractVersion{inForce(401, ptr(int64(9401)), "Benjamin")},
			issued:  map[int64]parentbilling.CareContractChild{402: identity(ptr(int64(9401)), "Ben"), 403: identity(nil, "Ben")},
			same:    [][]int64{{401, 402, 403}},
		},
		{
			// The child in force has no record; the issued contract has the
			// only record of its name and date of birth.
			name:    "a new record joins the child in force without a record",
			inForce: []parentbilling.CareContractVersion{inForce(411, nil, "Ben")},
			issued:  map[int64]parentbilling.CareContractChild{412: identity(ptr(int64(9412)), "Ben")},
			same:    [][]int64{{411, 412}},
		},
		{
			// Two issued contracts of one record, the lower one spelled
			// „Benjamin“: the record still joins the child „Ben“ in force.
			name:    "every spelling of an issued record counts",
			inForce: []parentbilling.CareContractVersion{inForce(431, nil, "Ben")},
			issued: map[int64]parentbilling.CareContractChild{
				432: identity(ptr(int64(9432)), "Benjamin"), 433: identity(ptr(int64(9432)), "Ben"),
			},
			same: [][]int64{{431, 432, 433}},
		},
		{
			// Two records of that name and date of birth: the issued one
			// stays apart.
			name:     "a second record of the name stays apart",
			inForce:  []parentbilling.CareContractVersion{inForce(421, ptr(int64(9421)), "Ben"), inForce(422, nil, "Ben")},
			issued:   map[int64]parentbilling.CareContractChild{423: identity(ptr(int64(9423)), "Ben")},
			same:     [][]int64{{421, 422}},
			separate: [][2]int64{{421, 423}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			byContract, order := versionsByContract(tc.inForce)
			keys := childKeys(byContract, childrenOf(byContract, order, contractFamilies(byContract, nil)), tc.issued)
			for _, group := range tc.same {
				for _, contractID := range group[1:] {
					assert.Equal(t, keys[group[0]], keys[contractID], "contract %d", contractID)
				}
			}
			for _, pair := range tc.separate {
				assert.NotEqual(t, keys[pair[0]], keys[pair[1]])
			}
		})
	}
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
	keys := childKeys(byContract, childrenOf(byContract, order, contractFamilies(byContract, nil)), nil)
	for i, contractID := range order {
		assert.Equal(t, "child:"+strconv.Itoa(i), keys[contractID])
	}
}
