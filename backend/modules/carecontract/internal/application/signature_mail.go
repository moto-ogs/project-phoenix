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
		return "Dein Betreuungsvertrag", contractMailTemplate, nil
	case carecontract.MailPurposeReminder:
		return "Erinnerung: Dein Betreuungsvertrag wartet auf deine Unterschrift", contractReminderMailTemplate, nil
	case carecontract.MailPurposeSigned:
		return "Bestätigung: Dein Betreuungsvertrag ist unterschrieben", contractSignedMailTemplate, nil
	case carecontract.MailPurposeAmendment:
		return "Dein Betreuungsvertrag ändert sich: Bitte unterschreibe die neue Fassung", contractAmendmentMailTemplate, nil
	case carecontract.MailPurposeAmended:
		return "Dein Betreuungsvertrag wurde geändert", contractAmendedMailTemplate, nil
	}
	return "", "", fmt.Errorf("%s payload has the unknown purpose %q", carecontract.MailKindContract, purpose)
}
