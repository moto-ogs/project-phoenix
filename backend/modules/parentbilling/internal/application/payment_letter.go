package application

import (
	"errors"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// How a letter names the payment of an invoice (#4689, ADR 0167). An invoice
// issued since #4689 carries its own payment method and due date, which
// ResolvePayment decided; an older one takes the date the letters of its run
// set.

// paymentMethodLabels name the payment methods on a letter and in the export.
var paymentMethodLabels = map[string]string{
	parentbilling.PaymentTransfer:    "Überweisung",
	parentbilling.PaymentDirectDebit: "Lastschrift",
}

// paymentMethodLabel is the name of a payment method, empty for none.
func paymentMethodLabel(method string) string { return paymentMethodLabels[method] }

// dueOnOf is the due date of an invoice: its own, else the date of the
// letters of its run.
func dueOnOf(payment *parentbilling.InvoicePayment, letters calendar.Date) calendar.Date {
	if payment != nil && !payment.DueOn.IsZero() {
		return payment.DueOn
	}
	return letters
}

// isDirectDebit tells whether the Träger collects the amount.
func isDirectDebit(payment *parentbilling.InvoicePayment) bool {
	return payment != nil && payment.Method == parentbilling.PaymentDirectDebit
}

// paymentFacts are the facts of the payment beside the address field: the
// payment method of an invoice issued since #4689 and the date it is paid
// or collected.
func paymentFacts(payment *parentbilling.InvoicePayment, letters calendar.Date) []LetterFact {
	due := germanDate(dueOnOf(payment, letters))
	if payment == nil {
		return []LetterFact{{Label: "Zahlen bis", Value: due}}
	}
	if isDirectDebit(payment) {
		return []LetterFact{{Label: "Zahlungsweg", Value: paymentMethodLabel(payment.Method)}, {Label: "Abbuchung am", Value: due}}
	}
	return []LetterFact{{Label: "Zahlungsweg", Value: paymentMethodLabel(payment.Method)}, {Label: "Zahlen bis", Value: due}}
}

// directDebitText announces the collection using the invoice's frozen payment.
func directDebitText(amountCents int64, due calendar.Date, reference string, mandate *parentbilling.InvoiceMandate,
	holder, recipient, secondRecipient string,
) string {
	if mandate == nil {
		return fmt.Sprintf("Wir buchen %s am %s von Ihrem Konto ab. Verwendungszweck: %s. Sie müssen nichts überweisen.",
			formatEuro(amountCents), germanDate(due), reference)
	}
	lines := []string{
		fmt.Sprintf("Wir buchen %s am %s per SEPA-Lastschrift ab.", formatEuro(amountCents), germanDate(due)),
		"Ist der Termin kein Bankarbeitstag? Dann buchen wir am nächsten Bankarbeitstag ab.",
	}
	if holder != "" {
		lines = append(lines, "Kontoinhaber: "+holder)
	}
	lines = append(lines,
		"Konto: "+mandate.IBANMasked+" · Mandatsreferenz: "+mandate.Reference,
		"Gläubiger-ID: "+mandate.CreditorID+" · Verwendungszweck: "+reference,
		"Sie müssen nichts überweisen. Am Abbuchungstag muss genug Geld auf dem Konto sein.",
	)
	if holder != "" && !sameBillingName(holder, recipient) && !sameBillingName(holder, secondRecipient) {
		lines = append(lines, "Sind Sie nicht der Kontoinhaber? Dann geben Sie dieses Schreiben bitte weiter.")
	}
	return strings.Join(lines, "\n")
}

// withDirectDebitNotice makes sure a custom template carries the notice.
func withDirectDebitNotice(blocks []LetterBlock, text string, payment *parentbilling.InvoicePayment, totalCents int64) []LetterBlock {
	if totalCents <= 0 || !isDirectDebit(payment) || paymentMandate(payment) == nil {
		return blocks
	}
	notice := LetterBlock{Heading: "SEPA-Lastschrift", Text: text}
	for i, block := range blocks {
		if block.Text == text && block.Heading == "" && len(block.Facts) == 0 {
			blocks[i] = notice
			return blocks
		}
		if strings.Contains(block.Text, text) {
			return blocks
		}
	}
	return append(blocks, notice)
}

func sameBillingName(a, b string) bool {
	return strings.EqualFold(strings.Join(strings.Fields(a), " "), strings.Join(strings.Fields(b), " "))
}

func secondLetterRecipient(kind, name string) string {
	if kind == parentbilling.RecipientBoth {
		return name
	}
	return ""
}

func hasInvoiceAccountHolder(payment *parentbilling.InvoicePayment) bool {
	return isDirectDebit(payment) && payment.Mandate != nil && len(payment.Mandate.HolderSealed) > 0
}

// addHolderSnapshotRead records which invoices opened their stored holder.
// The invoice's audit trail survives independently of the original mandate.
func addHolderSnapshotRead(details map[string]any, id, totalCents int64, payment *parentbilling.InvoicePayment) {
	if totalCents > 0 && hasInvoiceAccountHolder(payment) {
		ids, _ := details["account_holder_snapshot_ids"].([]int64)
		details["account_holder_snapshot_ids"] = append(ids, id)
	}
}

// invoiceAccountHolder opens the invoice's own copy, which uses the same
// Träger and reference binding as the sealed field on the mandate.
func invoiceAccountHolder(cipher parentbilling.BankDataCipher, organizationID int64, payment *parentbilling.InvoicePayment) (string, error) {
	if !hasInvoiceAccountHolder(payment) {
		return "", nil
	}
	mandate := payment.Mandate
	holder, err := cipher.Open(mandate.HolderSealed, holderContext(organizationID, mandate.Reference))
	if err != nil {
		return "", errors.New("parent billing: the invoice account holder does not open")
	}
	return strings.Join(strings.Fields(string(holder)), " "), nil
}

// paymentMandate is the mandate of a payment, nil without one.
func paymentMandate(payment *parentbilling.InvoicePayment) *parentbilling.InvoiceMandate {
	if payment == nil {
		return nil
	}
	return payment.Mandate
}

// billingRecipientLines are the lines of the address field: another payer
// by name with its address, both parents by both names, the family
// otherwise, then the address when the invoice has one.
func billingRecipientLines(kind, firstName, lastName, secondName string, address *parentbilling.PostalAddress) []string {
	var lines []string
	switch kind {
	case parentbilling.RecipientPayer:
		lines = []string{fullName(firstName, lastName)}
	case parentbilling.RecipientBoth:
		lines = []string{"Familie " + strings.TrimSpace(lastName), fullName(firstName, lastName) + " und " + strings.TrimSpace(secondName)}
	default:
		lines = []string{"Familie " + strings.TrimSpace(lastName), fullName(firstName, lastName)}
	}
	if address != nil {
		lines = append(lines, address.Street, strings.TrimSpace(address.PostalCode)+" "+strings.TrimSpace(address.City))
	}
	return nonBlank(lines...)
}
