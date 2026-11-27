package application

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// sepaInvoice is the SJR invoice collected by direct debit with its
// mandate (#4695, ADR 0171).
func sepaInvoice() careLetterContent {
	content := careLetterSJR()
	content.invoice.Payment = &parentbilling.InvoicePayment{
		Method: parentbilling.PaymentDirectDebit, DueOn: calendar.NewDate(2027, 1, 18), DueSource: parentbilling.DueFromRun,
		Mandate: &parentbilling.InvoiceMandate{MandateID: 9, Reference: "SJR-2026-0042", SignedOn: calendar.NewDate(2026, 9, 1),
			CreditorID: "DE98ZZZ09999999999", IBANMasked: "DE•• •••• •••• •••• ••30 00", SequenceType: parentbilling.SequenceTypeRecurring},
	}
	return content
}

// The pre-notification names amount, debit date, the masked account, the
// creditor identifier and the mandate reference, in the payment notice
func TestCareLetterCarriesTheSEPAPrenotification(t *testing.T) {
	t.Parallel()
	text := careLetterText(careInvoiceLetter(sepaInvoice()))
	for _, want := range []string{
		"Zahlungsweg: Lastschrift", "Abbuchung am: 18.01.2027",
		"Ist der Termin kein Bankarbeitstag? Dann buchen wir am nächsten Bankarbeitstag ab.",
		"Wir buchen 54,01 € am 18.01.2027 per SEPA-Lastschrift ab.",
		"Konto: DE•• •••• •••• •••• ••30 00 · Mandatsreferenz: SJR-2026-0042",
		"Gläubiger-ID: DE98ZZZ09999999999 · Verwendungszweck: Rechnungsnummer MB-2027-0001",
	} {
		assert.Contains(t, text, want)
	}
	assert.NotContains(t, text, "DE89370400440532013000", "the letter never prints the full IBAN")
	assert.NotContains(t, text, "Bitte überweise", "a direct debit asks for no transfer")
}

// The pre-notification announces what the family pays: the rest after the
// share of a cost bearer (#4687, ADR 0169), never the whole contribution.
func TestSEPAPrenotificationAnnouncesTheFamilysShareAfterTheCostBearer(t *testing.T) {
	t.Parallel()
	content := sepaInvoice()
	basis := 5000
	content.invoice.CostShares = []parentbilling.CareInvoiceCostShare{{Kind: parentbilling.CostShareYouthOffice,
		CostBearerName: "Jugendamt Pforzheim", ShareBasisPoints: &basis, AmountCents: 2700}}
	content.invoice.TotalCents = 2701
	text := careLetterText(careInvoiceLetter(content))
	assert.Contains(t, text, "Wir buchen 27,01 € am 18.01.2027 per SEPA-Lastschrift")
	assert.NotContains(t, text, "Wir buchen 54,01 €", "the cost bearer's share is not collected from the family")
}

// An invoice issued by direct debit before #4695 has no mandate and keeps
// the short sentence.
func TestDirectDebitWithoutMandateKeepsTheShortSentence(t *testing.T) {
	t.Parallel()
	content := sepaInvoice()
	content.invoice.Payment.Mandate = nil
	assert.Equal(t, "Wir buchen 54,01 € am 18.01.2027 von Ihrem Konto ab. Verwendungszweck: Rechnungsnummer MB-2027-0001. Sie müssen nichts überweisen.",
		carePaymentText(content))
}

// Only an invoice that collects money and stays a direct debit without a
// mandate holds the release back (MissingMandateBlock).
func TestDebitBlockedOnlyByAnAmountWithoutMandate(t *testing.T) {
	t.Parallel()
	gap := &parentbilling.InvoicePayment{Method: parentbilling.PaymentDirectDebit, DebitGap: parentbilling.DebitGapMandate}
	assert.True(t, debitBlocked(7800, gap))
	assert.False(t, debitBlocked(0, gap), "a cost bearer pays all: nothing to collect")
	assert.False(t, debitBlocked(7800, &parentbilling.InvoicePayment{Method: parentbilling.PaymentTransfer,
		DebitGap: parentbilling.DebitGapMandate}), "the fallback transfer goes out")
	assert.False(t, debitBlocked(7800, &parentbilling.InvoicePayment{Method: parentbilling.PaymentDirectDebit,
		Mandate: &parentbilling.InvoiceMandate{Reference: "SJR-1"}}))
	assert.False(t, debitBlocked(7800, nil))
}

func careInvoiceWithLongFooter() careLetterContent {
	content := sepaInvoice()
	content.accountHolder = "Jan Muster"
	content.invoice.SchoolName = "Grundschule am Park"
	content.invoice.Recipient.Address = &parentbilling.PostalAddress{Street: "Lindenweg 8", PostalCode: "12345", City: "Beispielstadt"}
	content.input.Notes = ""
	content.letterhead.SenderText = "Ganztag Beispielstadt gGmbH\nParkstraße 12\n12345 Beispielstadt"
	content.letterhead.AccentColor = "#0F6659"
	content.letterhead.ContactName = ""
	content.letterhead.ContactPhone = "01234 555-10"
	content.letterhead.ContactEmail = "abrechnung@example.org"
	content.letterhead.FooterText = "Geschäftsführung: Nora Muster und Felix Beispiel\nAmtsgericht Beispielstadt · HRB 123456 · Steuernummer 12/345/67890\nMusterbank Beispielstadt · IBAN DE00 0000 0000 0000 0000 02 · BIC TESTDEFF002\nFür diese Leistung berechnen wir keine Umsatzsteuer."
	content.letterhead.BankAccount = &parentbilling.LetterheadBankAccount{AccountHolder: "Ganztag Beispielstadt gGmbH", IBAN: "DE00000000000000000001", BIC: "TESTDEFF001", BankName: "Beispielbank"}
	return content
}

// The golden invoice uses invented names, numbers and addresses.
func TestCareInvoiceDirectDebitGolden(t *testing.T) {
	t.Parallel()
	want, err := os.ReadFile("testdata/care-invoice-direct-debit.golden")
	require.NoError(t, err)
	letter := careInvoiceLetter(careInvoiceWithLongFooter())
	assert.Equal(t, string(want), careLetterText(letter)+"\n")
}

func TestDirectDebitForwardingDependsOnTheNamedRecipients(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		holder, kind, second string
		wantsForwarding      bool
	}{
		{holder: "Eva Beispiel"},
		{holder: "  EVA   Beispiel "},
		{},
		{holder: "Nora Muster", kind: parentbilling.RecipientBoth, second: "Nora Muster"},
		{holder: "Jan Muster", kind: parentbilling.RecipientBoth, second: "Nora Muster", wantsForwarding: true},
		{holder: "Nora Muster", kind: parentbilling.RecipientApplicant, second: "Nora Muster", wantsForwarding: true},
	} {
		content := sepaInvoice()
		content.invoice.Recipient.Kind = tc.kind
		content.invoice.Recipient.SecondName = tc.second
		content.accountHolder = tc.holder
		assert.Equal(t, tc.wantsForwarding, strings.Contains(carePaymentText(content), "geben Sie dieses Schreiben bitte weiter"), tc)
	}
}

func TestHolidayInvoiceIncludesTheNoticeWithACustomTemplate(t *testing.T) {
	t.Parallel()
	content := goldenLetterContent(t)
	content.document.DocumentKind = parentbilling.DocumentKindInvoice
	content.document.Payment = sepaInvoice().invoice.Payment
	content.accountHolder = "Jan Muster"
	content.letterhead.Template.Body = "{{positionen}}"
	var body []string
	for _, block := range confirmationLetter(content).Blocks {
		body = append(body, block.Text)
	}
	text := strings.Join(body, "\n")
	assert.Contains(t, text, "Kontoinhaber: Jan Muster")
	assert.Contains(t, text, "Sind Sie nicht der Kontoinhaber? Dann geben Sie dieses Schreiben bitte weiter.")
	assert.Equal(t, 1, strings.Count(text, "Mandatsreferenz:"))
}
