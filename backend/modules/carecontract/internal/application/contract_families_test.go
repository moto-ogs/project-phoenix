package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// A join names at least two different contracts and its leading contract
// among them (#7161).
func TestJoinRequestNeedsTwoContractsAndTheLeadAmongThem(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		input  carecontract.FamilyJoinInput
		reason string
	}{
		{"one", carecontract.FamilyJoinInput{ContractIDs: []ident.ID{4}, FamilyContractID: 4}, "too_few"},
		{"repeated", carecontract.FamilyJoinInput{ContractIDs: []ident.ID{4, 4}, FamilyContractID: 4}, "repeated"},
		{"lead outside", carecontract.FamilyJoinInput{ContractIDs: []ident.ID{4, 5}, FamilyContractID: 6}, "not_chosen"},
		{"no contract", carecontract.FamilyJoinInput{ContractIDs: []ident.ID{0, 5}, FamilyContractID: 5}, "invalid"},
	} {
		_, _, err := joinRequest(tc.input)
		var invalid *carecontract.ValidationError
		require.ErrorAs(t, err, &invalid, tc.name)
		assert.True(t, invalid.Selection, tc.name)
		assert.Contains(t, invalid.Fields, map[string]string{"one": "contract_ids", "repeated": "contract_ids",
			"lead outside": "family_contract_id", "no contract": "contract_ids"}[tc.name], tc.name)
		for _, reason := range invalid.Fields {
			assert.Equal(t, tc.reason, reason, tc.name)
		}
	}
	ids, lead, err := joinRequest(carecontract.FamilyJoinInput{ContractIDs: []ident.ID{4, 5}, FamilyContractID: 5})
	require.NoError(t, err)
	assert.Equal(t, []int64{4, 5}, ids)
	assert.Equal(t, ids[1], lead, "the second contract leads")
}

// The version of the families changes with every led contract and with
// nothing else.
func TestFamiliesVersionFollowsTheLedContracts(t *testing.T) {
	t.Parallel()
	alone := []carecontract.FamilyMember{{ContractID: 4, FamilyContractID: 4}, {ContractID: 5, FamilyContractID: 5}}
	joined := []carecontract.FamilyMember{{ContractID: 4, FamilyContractID: 4}, {ContractID: 5, FamilyContractID: 4}}
	other := []carecontract.FamilyMember{{ContractID: 5, FamilyContractID: 4}, {ContractID: 4, FamilyContractID: 4}, {ContractID: 9, FamilyContractID: 9}}
	assert.NotEqual(t, familiesVersion(alone), familiesVersion(joined))
	assert.Equal(t, familiesVersion(joined), familiesVersion(other), "order and contracts alone change nothing")
	assert.Equal(t, familiesVersion(alone), familiesVersion(nil))
}
