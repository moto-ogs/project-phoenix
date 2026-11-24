package postgres

import (
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The issuer an issued document keeps (#8040, ADR 0321): issuer_key names
// it, empty for the Träger, and issuer holds what the document prints of a
// body at the release, NULL for the Träger.

// issuerRow is the column issuer: sender, contact, bank account and the
// creditor identifier of a body.
type issuerRow struct {
	Key          string         `json:"key"`
	Body         string         `json:"body"`
	Name         string         `json:"name"`
	SenderText   string         `json:"sender_text"`
	ContactName  string         `json:"contact_name"`
	ContactPhone string         `json:"contact_phone"`
	ContactEmail string         `json:"contact_email"`
	CreditorID   string         `json:"creditor_id"`
	BankAccount  *issuerBankRow `json:"bank_account,omitempty"`
}

type issuerBankRow struct {
	AccountHolder string `json:"account_holder"`
	IBAN          string `json:"iban"`
	BIC           string `json:"bic"`
	BankName      string `json:"bank_name"`
}

// issuerColumns are the key and the issuer column of a document of the
// issuer: the empty key and NULL for the Träger.
func issuerColumns(issuer *parentbilling.BillingIssuer) (string, *issuerRow) {
	if issuer == nil || issuer.IsTraeger() {
		return "", nil
	}
	row := &issuerRow{Key: issuer.Key, Body: issuer.Body, Name: issuer.Name, SenderText: issuer.SenderText,
		ContactName: issuer.ContactName, ContactPhone: issuer.ContactPhone, ContactEmail: issuer.ContactEmail, CreditorID: issuer.Key}
	if account := issuer.BankAccount; account != nil {
		row.BankAccount = &issuerBankRow{AccountHolder: account.AccountHolder, IBAN: account.IBAN, BIC: account.BIC, BankName: account.BankName}
	}
	return issuer.Key, row
}

// issuer is the issuer the column holds, nil for the Träger.
func (r *issuerRow) issuer() *parentbilling.BillingIssuer {
	if r == nil || r.Key == "" {
		return nil
	}
	issuer := &parentbilling.BillingIssuer{Key: r.Key, Body: r.Body, Name: r.Name, SenderText: r.SenderText,
		ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, CreditorID: r.CreditorID}
	if account := r.BankAccount; account != nil {
		issuer.BankAccount = &parentbilling.LetterheadBankAccount{AccountHolder: account.AccountHolder, IBAN: account.IBAN,
			BIC: account.BIC, BankName: account.BankName}
	}
	return issuer
}
