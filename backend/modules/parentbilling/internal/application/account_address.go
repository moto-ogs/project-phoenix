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
	if effective.Kind == parentbilling.RecipientPayer || account == "" || strings.EqualFold(account, signed) {
		return effective
	}
	// An imported contract without a signed address is still its own family.
	// Its parent's account receives the invoice, without moving debtor
	// numbers, SEPA mandates or billing deviations to the account address.
	if signed == "" {
		effective.Email, effective.ContractFamily = account, true
		return effective
	}
	effective.ContractEmail, effective.Email = effective.Email, account
	return effective
}
