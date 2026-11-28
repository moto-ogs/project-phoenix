package application

import (
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// toAccountAddress sends the invoice of the contract party to the address
// of its parents account today (#8215). The contract keeps the address it
// was signed with: it still names the family, and the invoice keeps it in
// ContractEmail so the Träger-Büro sees that the two differ. A payer of the
// family's deviation has no account here and keeps its own address.
func toAccountAddress(applicant, effective parentbilling.CareRecipient) parentbilling.CareRecipient {
	account, signed := strings.TrimSpace(applicant.AccountEmail), strings.TrimSpace(effective.Email)
	// Without a signed address the contract names its family by itself;
	// replacing nothing keeps that key (ADR 0232).
	if effective.Kind == parentbilling.RecipientPayer || account == "" || signed == "" ||
		strings.EqualFold(account, signed) {
		return effective
	}
	effective.ContractEmail, effective.Email = effective.Email, account
	return effective
}
