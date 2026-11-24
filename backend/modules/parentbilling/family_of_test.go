package parentbilling_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The family of a contract (#7161, ADR 0319 points 3 and 7): the mail
// address of its party first, then the leading contract the office joined
// it to, then the contract itself.
func TestFamilyOfPrefersTheAddressThenTheLeadingContract(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name      string
		recipient parentbilling.CareRecipient
		want      string
	}{
		{"alone", parentbilling.CareRecipient{}, "contract:12"},
		{"joined", parentbilling.CareRecipient{FamilyContractID: 7}, "contract:7"},
		{"address", parentbilling.CareRecipient{Email: " Eva@Example.org ", FamilyContractID: 7}, "eva@example.org"},
	} {
		assert.Equal(t, tc.want, tc.recipient.FamilyOf(12), tc.name)
	}
}
