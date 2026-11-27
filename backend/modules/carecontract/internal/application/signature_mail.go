package application

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// The mails of the signature (#4679): the reminder with a new one-time link
// and the confirmation with the signed PDF and the withdrawal notice.
const (
	contractReminderMailTemplate = "care-contract-reminder.html"
	contractSignedMailTemplate   = "care-contract-signed.html"
	// The mails of a changed version (#4816): the request to sign it, and
	// the version the parents asked for themselves.
	contractAmendmentMailTemplate = "care-contract-amendment.html"
	contractAmendedMailTemplate   = "care-contract-amended.html"
)

func contractMailKind(purpose string) (string, string, error) {
	switch purpose {
	case carecontract.MailPurposeContract:
		return "Ihr Betreuungsvertrag", contractMailTemplate, nil
	case carecontract.MailPurposeReminder:
		return "Erinnerung: Ihr Betreuungsvertrag wartet auf Ihre Unterschrift", contractReminderMailTemplate, nil
	case carecontract.MailPurposeSigned:
		return "Bestätigung: Ihr Betreuungsvertrag ist unterschrieben", contractSignedMailTemplate, nil
	case carecontract.MailPurposeAmendment:
		return "Ihr Betreuungsvertrag ändert sich: Bitte unterschreiben Sie die neue Fassung", contractAmendmentMailTemplate, nil
	case carecontract.MailPurposeAmended:
		return "Ihr Betreuungsvertrag wurde geändert", contractAmendedMailTemplate, nil
	}
	return "", "", fmt.Errorf("%s payload has the unknown purpose %q", carecontract.MailKindContract, purpose)
}
