package application

import (
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The transfer code of a contribution document (#4818): the QR code of the
// European Payments Council (EPC069-12, „GiroCode“) that a banking app reads
// into a filled-in SEPA credit transfer. The letter prints it beside the
// payment text when the family pays by transfer; it is part of the PDF the
// letters store once, so it never changes after the issue.

// PaymentCode is the transfer code of a letter: the payload the renderer
// encodes as a QR code, a heading and a sentence beside it, and the data
// it carries in plain text for a family that types the transfer by hand.
type PaymentCode struct {
	Payload string
	Heading string
	Text    string
	Facts   []LetterFact
}

// The limits of EPC069-12 version 002 in characters, and the largest
// amount a code can carry.
const (
	epcNameLimit       = 70
	epcRemittanceLimit = 140
	epcIBANLimit       = 34
	epcPayloadLimit    = 331 // bytes of the whole payload
	epcMaxCents        = 99999999999
)

// transferCode is the code of a transfer of cents to the account under
// reference. The name is the account holder, else senderName, the first
// line of the letterhead. Without an amount to transfer, an account, a
// name or a reference there is no code.
func transferCode(to letterAddressee, account *parentbilling.LetterheadBankAccount, senderName string, cents int64, reference string) (PaymentCode, bool) {
	if account == nil || cents <= 0 || cents > epcMaxCents {
		return PaymentCode{}, false
	}
	iban := compactIBAN(account.IBAN)
	// One line each: a line break would shift every later field.
	name := strings.Join(strings.Fields(firstNonBlank(account.AccountHolder, senderName)), " ")
	reference = strings.Join(strings.Fields(reference), " ")
	if iban == "" || len(iban) > epcIBANLimit || name == "" || reference == "" {
		return PaymentCode{}, false
	}
	name, reference = cutRunes(name, epcNameLimit), cutRunes(reference, epcRemittanceLimit)
	head := strings.Join([]string{
		"BCD", "002", "1", "SCT",
		epcBIC(account.BIC),
		name,
		iban,
		fmt.Sprintf("EUR%d.%02d", cents/100, cents%100),
		"", // purpose
		"", // structured creditor reference
		"",
	}, "\n")
	// The whole payload holds at most 331 bytes: names and references
	// in umlauts take two bytes a character, so the reference is cut to
	// the bytes left, at a character.
	for len(head)+len(reference) > epcPayloadLimit && reference != "" {
		reference = cutRunes(reference, len([]rune(reference))-1)
	}
	if reference == "" {
		return PaymentCode{}, false
	}
	payload := head + reference
	return PaymentCode{
		Payload: payload,
		Heading: "Bezahlen per QR-Code",
		Text:    to.say("Scannt den Code mit eurer Banking-App und überweist.", "Scanne den Code mit deiner Banking-App und überweise."),
		Facts: []LetterFact{
			{Label: "Empfänger", Value: name},
			{Label: "IBAN", Value: groupIBAN(iban)},
			{Label: "Betrag", Value: formatEuro(cents)},
			{Label: "Verwendungszweck", Value: reference},
		},
	}, true
}

// epcBIC is the BIC of the account as the code carries it: version 002
// lets it out, so a BIC that is not 8 or 11 letters and digits stays out
// rather than making the code unreadable.
func epcBIC(bic string) string {
	bic = strings.ToUpper(strings.TrimSpace(bic))
	if len(bic) != 8 && len(bic) != 11 {
		return ""
	}
	for _, r := range bic {
		if (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			return ""
		}
	}
	return bic
}

func compactIBAN(iban string) string {
	return strings.ToUpper(strings.Join(strings.Fields(iban), ""))
}

func firstNonBlank(values ...string) string {
	if kept := nonBlank(values...); len(kept) > 0 {
		return kept[0]
	}
	return ""
}

// cutRunes keeps the first limit characters of value.
func cutRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// documentReference is the reference to pay with of a document: its number
// and, when it has one, the debtor number the Träger matches payments by,
// named as the document names it, the Buchungszeichen of a fee notice.
func documentReference(number, debtorNumber, documentKind string) string {
	debtorNumber = strings.TrimSpace(debtorNumber)
	if debtorNumber == "" {
		return number
	}
	label := "Debitorennummer"
	if documentKind == parentbilling.DocumentKindFeeNotice {
		label = "Buchungszeichen"
	}
	return number + " " + label + " " + debtorNumber
}

// transferCodeOf is the code of a document the family pays by transfer;
// nil for a direct debit, without an amount to transfer or when the Träger
// switched the code off (#5624). An invoice issued before #4689 has no
// payment and is paid by transfer.
func transferCodeOf(to letterAddressee, head parentbilling.Letterhead, payment *parentbilling.InvoicePayment, cents int64, reference string) *PaymentCode {
	if head.WithoutTransferCode || isDirectDebit(payment) {
		return nil
	}
	code, ok := transferCode(to, head.BankAccount, firstLine(textLines(head.SenderText)), cents, reference)
	if !ok {
		return nil
	}
	return &code
}

// careTransferCode is the code of a monthly invoice; its Storno has none.
func careTransferCode(content careLetterContent) *PaymentCode {
	if content.cancellation != nil {
		return nil
	}
	invoice := content.invoice
	return transferCodeOf(recipientAddressee(invoice.Recipient), content.letterhead, invoice.Payment, invoice.TotalCents,
		documentReference(invoice.Number, invoice.DebtorNumber, invoice.DocumentKind))
}

// withTransferCode puts the code right after the block that asks for the
// transfer, or after the last block when no block holds the payment text,
// such as a template of the Träger without it.
func withTransferCode(blocks []LetterBlock, paymentText string, code *PaymentCode) []LetterBlock {
	if code == nil {
		return blocks
	}
	at := len(blocks)
	if paymentText = strings.TrimSpace(paymentText); paymentText != "" {
		for i, block := range blocks {
			if strings.Contains(block.Text, paymentText) {
				at = i + 1
				break
			}
		}
	}
	return append(blocks[:at:at], append([]LetterBlock{{PaymentCode: code}}, blocks[at:]...)...)
}

// carriesPaymentCode reports whether a block of the body is a transfer code.
func carriesPaymentCode(blocks []LetterBlock) bool {
	for _, block := range blocks {
		if block.PaymentCode != nil {
			return true
		}
	}
	return false
}
