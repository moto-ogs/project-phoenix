package owners

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// Two schools of one creditor identifier print the same sender and account,
// those of the school with the lowest ID, on every read (#8040, ADR 0321
// point 2): the debit file and its message ID never depend on map order.
func TestSchoolsOfOneCreditorShareTheIssuerOfTheirFirstSchool(t *testing.T) {
	t.Parallel()
	const firstSchool, secondSchool, otherSchool int64 = 3, 7, 5
	for range 20 {
		issuers := oneIssuerPerCreditor(map[int64]parentbilling.BillingIssuer{
			secondSchool: {Key: "DE13ZZZ00000012345", Name: "Stadtkasse Hardt"},
			firstSchool:  {Key: "DE13ZZZ00000012345", Name: "Gemeinde Hardt"},
			otherSchool:  {Key: "DE15ZZZ00000067890", Name: "Gemeinde Wallenhorst"},
		})
		assert.Equal(t, "Gemeinde Hardt", issuers[secondSchool].Name)
		assert.Equal(t, "Gemeinde Hardt", issuers[firstSchool].Name)
		assert.Equal(t, "Gemeinde Wallenhorst", issuers[otherSchool].Name)
	}
}
