package organizationtenancy_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// TestEffectiveBodyNeedsStoredMasterData pins the rule of #4811 that no
// document names a body without an address: the chosen Schulträger or
// Gemeinde is responsible only once its master data are stored, and for
// billing only with a creditor identifier and a bank account.
func TestEffectiveBodyNeedsStoredMasterData(t *testing.T) {
	t.Parallel()
	bare := organizationtenancy.SchoolParty{Kind: organizationtenancy.BodyGemeinde, Name: "Gemeinde Hardt"}
	billing := bare
	billing.CreditorID, billing.IBAN = "DE98ZZZ09999999999", "DE02120300000000202051"
	stored := func(party organizationtenancy.SchoolParty) map[organizationtenancy.ResponsibleBody]organizationtenancy.SchoolParty {
		return map[organizationtenancy.ResponsibleBody]organizationtenancy.SchoolParty{party.Kind: party}
	}
	for name, test := range map[string]struct {
		area    organizationtenancy.ResponsibilityArea
		chosen  organizationtenancy.ResponsibleBody
		parties map[organizationtenancy.ResponsibleBody]organizationtenancy.SchoolParty
		want    organizationtenancy.ResponsibleBody
	}{
		"the Träger needs no master data here":      {organizationtenancy.ResponsibilityContracts, organizationtenancy.BodyTraeger, nil, organizationtenancy.BodyTraeger},
		"a Gemeinde without master data":            {organizationtenancy.ResponsibilityContracts, organizationtenancy.BodyGemeinde, nil, organizationtenancy.BodyTraeger},
		"the other body is stored":                  {organizationtenancy.ResponsibilityStaff, organizationtenancy.BodySchultraeger, stored(bare), organizationtenancy.BodyTraeger},
		"a stored Gemeinde concludes contracts":     {organizationtenancy.ResponsibilityContracts, organizationtenancy.BodyGemeinde, stored(bare), organizationtenancy.BodyGemeinde},
		"a stored Gemeinde employs":                 {organizationtenancy.ResponsibilityStaff, organizationtenancy.BodyGemeinde, stored(bare), organizationtenancy.BodyGemeinde},
		"billing without creditor and bank account": {organizationtenancy.ResponsibilityBilling, organizationtenancy.BodyGemeinde, stored(bare), organizationtenancy.BodyTraeger},
		"billing with creditor and bank account":    {organizationtenancy.ResponsibilityBilling, organizationtenancy.BodyGemeinde, stored(billing), organizationtenancy.BodyGemeinde},
		"an unknown body never becomes responsible": {organizationtenancy.ResponsibilityContracts, organizationtenancy.ResponsibleBody("kirche"), stored(bare), organizationtenancy.BodyTraeger},
	} {
		assert.Equal(t, test.want, organizationtenancy.EffectiveBody(test.area, test.chosen, test.parties), name)
	}
}
