package application

import (
	"flag"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Regenerate after a deliberate text change:
// go test ./modules/parentbilling/internal/application -run LettersSpeakToTheirAddressee -update-addressee-goldens
var updateAddresseeGoldens = flag.Bool("update-addressee-goldens", false, "rewrite the golden letters per recipient kind")

// addresseeRecipient is one kind of recipient of the golden letters.
type addresseeRecipient struct {
	golden, kind, firstName, lastName, secondName string
	address                                       *parentbilling.PostalAddress
}

var addresseeRecipients = []addresseeRecipient{
	{golden: "family", kind: parentbilling.RecipientApplicant, firstName: "Erika", lastName: "Beispiel"},
	{golden: "both", kind: parentbilling.RecipientBoth, firstName: "Erika", lastName: "Beispiel", secondName: "Ben Beispiel"},
	{golden: "payer", kind: parentbilling.RecipientPayer, firstName: "Karin", lastName: "Muster",
		address: &parentbilling.PostalAddress{Street: "Lindenweg 8", PostalCode: "12345", City: "Beispielstadt"}},
}

// ihrForm finds the plural address; duForm the singular one. The
// fixtures keep every Träger text free of both, so a hit is moto's text.
var (
	ihrForm = regexp.MustCompile(`(?i)\b(ihr|euch|euer|eure[mnrs]?|habt|müsst|seid|gebt|meldet|überweist|scannt|beachtet)\b`)
	duForm  = regexp.MustCompile(`(?i)\b(du|dich|dir|dein|deine[mnrs]?|hast|musst|bist|gib|melde|überweise|scanne|beachte|erreichst)\b`)
)

// TestLettersSpeakToTheirAddressee pins every letter moto writes in
// parent billing for the family, both parents and another payer (ADR 0294,
// #7463): a letter to the family or to both parents greets the family and
// says "ihr"; a letter to another payer greets the person by name and says
// "du" in every sentence after it.
func TestLettersSpeakToTheirAddressee(t *testing.T) {
	t.Parallel()
	for _, recipient := range addresseeRecipients {
		t.Run(recipient.golden, func(t *testing.T) {
			t.Parallel()
			text := addresseeLetters(t, recipient)
			path := "testdata/letter-addressee-" + recipient.golden + ".golden"
			if *updateAddresseeGoldens {
				require.NoError(t, os.WriteFile(path, []byte(text), 0o600))
			}
			want, err := os.ReadFile(path)
			require.NoError(t, err)
			assert.Equal(t, string(want), text)

			if recipient.kind == parentbilling.RecipientPayer {
				assert.Empty(t, ihrForm.FindAllString(text, -1), "a letter to one person says du")
				assert.Contains(t, text, "Guten Tag Karin Muster,")
				assert.NotContains(t, text, "Familie")
			} else {
				assert.Empty(t, duForm.FindAllString(text, -1), "a letter to the family says ihr")
				assert.Contains(t, text, "Liebe Familie Beispiel,")
				assert.NotContains(t, text, "Guten Tag")
			}
		})
	}
}

// A Träger's own template keeps its wording for one person too (#7462);
// only the texts moto puts into it speak to the person.
func TestATraegerTemplateKeepsItsWordingForOnePerson(t *testing.T) {
	t.Parallel()
	content := addresseeHolidayContent(t, addresseeRecipients[2], parentbilling.DocumentKindInvoice)
	content.letterhead.Template = parentbilling.LetterTemplate{Subject: "Rechnung {{rechnungsnummer}}",
		Salutation: "Sehr geehrte Damen und Herren,", Body: "anbei Ihre Rechnung.\n\n{{zahlungshinweis}}", Closing: "Ihr Träger"}
	letter := confirmationLetter(content)
	assert.Equal(t, "Sehr geehrte Damen und Herren,", letter.Salutation)
	assert.Equal(t, []string{"Ihr Träger"}, letter.Closing)
	text := addresseeLetterText(letter)
	assert.Contains(t, text, "anbei Ihre Rechnung.")
	assert.Contains(t, text, "Bitte überweise 92,50 € bis zum 15.12.2026 auf das Konto unten. Gib als Verwendungszweck deine Debitorennummer 10234 an.")
}

// addresseeLetters renders every letter for the recipient, one after the
// other.
func addresseeLetters(t *testing.T, recipient addresseeRecipient) string {
	t.Helper()
	var texts []string
	for _, letter := range addresseeLetterSet(t, recipient) {
		texts = append(texts, "=== "+letter.name+"\n"+addresseeLetterText(letter.letter))
	}
	return strings.Join(texts, "\n") + "\n"
}

// namedLetter is one golden letter with the name of its kind.
type namedLetter struct {
	name   string
	letter Letter
}

// addresseeLetterSet writes every kind of letter for the recipient.
func addresseeLetterSet(t *testing.T, recipient addresseeRecipient) []namedLetter {
	t.Helper()
	var letters []namedLetter
	add := func(name string, letter Letter) { letters = append(letters, namedLetter{name, letter}) }

	confirmation := addresseeHolidayContent(t, recipient, "")
	add("Bestätigung und Rechnung (Ferien)", confirmationLetter(confirmation))
	free := addresseeHolidayContent(t, recipient, "")
	free.document.TotalCents = 0
	add("Zahlungshinweis ohne Betrag (Ferien)", Letter{Blocks: []LetterBlock{{Text: paymentText(free)}}})
	free.document.Children[1].Positions = append(free.document.Children[1].Positions,
		parentbilling.BillingPosition{Kind: parentbilling.LineCostTakeover, CostBearerName: "Jugendamt Beispielstadt"})
	add("Zahlungshinweis mit Kostenübernahme (Ferien)", Letter{Blocks: []LetterBlock{{Text: paymentText(free)}}})

	invoice := addresseeHolidayContent(t, recipient, parentbilling.DocumentKindInvoice)
	invoice.document.Payment = addresseeDirectDebit()
	invoice.accountHolder = "Jan Muster"
	add("Rechnung per Lastschrift (Ferien)", confirmationLetter(invoice))

	notice := addresseeHolidayContent(t, recipient, parentbilling.DocumentKindFeeNotice)
	add("Gebührenbescheid (Ferien)", confirmationLetter(notice))

	for _, correction := range []struct {
		name, kind, documentKind string
		write                    func(letterContent) Letter
	}{
		{"Storno (Ferien)", parentbilling.DocumentCancellation, parentbilling.DocumentKindInvoice, cancellationLetter},
		{"Gutschrift (Ferien)", parentbilling.DocumentCredit, parentbilling.DocumentKindInvoice, creditLetter},
		{"Aufhebungsbescheid (Ferien)", parentbilling.DocumentCancellation, parentbilling.DocumentKindFeeNotice, cancellationLetter},
		{"Änderungsbescheid (Ferien)", parentbilling.DocumentCredit, parentbilling.DocumentKindFeeNotice, creditLetter},
	} {
		add(correction.name, correction.write(addresseeCorrection(t, recipient, correction.kind, correction.documentKind)))
	}

	care := addresseeCareContent(recipient)
	add("Monatsrechnung", careInvoiceLetter(care))
	debit := addresseeCareContent(recipient)
	debit.invoice.Payment, debit.accountHolder = addresseeDirectDebit(), "Jan Muster"
	add("Monatsrechnung per Lastschrift", careInvoiceLetter(debit))
	withoutMandate := addresseeCareContent(recipient)
	withoutMandate.invoice.Payment = &parentbilling.InvoicePayment{Method: parentbilling.PaymentDirectDebit, DueOn: calendar.NewDate(2027, 1, 18)}
	add("Monatsrechnung per Lastschrift ohne Mandat", careInvoiceLetter(withoutMandate))
	shared := addresseeCareContent(recipient)
	basisPoints := 10000
	shared.invoice.CostShares = []parentbilling.CareInvoiceCostShare{{Kind: parentbilling.CostShareYouthOffice,
		CostBearerName: "Jugendamt Beispielstadt", ShareBasisPoints: &basisPoints, AmountCents: 5401}}
	shared.invoice.TotalCents = 0
	add("Monatsrechnung mit Kostenübernahme", careInvoiceLetter(shared))
	add("Storno der Monatsrechnung", careCancellationLetter(addresseeCareCancellation(recipient)))
	add("Gebührenbescheid des Monats", careNoticeLetter(addresseeCareNotice(recipient)))
	lifted := addresseeCareCancellation(recipient)
	lifted.letterhead.Template.LegalRemedy = "Gegen diesen Bescheid ist Widerspruch möglich."
	add("Aufhebungsbescheid des Monats", careNoticeCancellationLetter(lifted))
	add("Jahresbescheid", feeNoticeLetter(addresseeYearNotice(recipient), addresseeCareContent(recipient).letterhead))
	return letters
}

func addresseeLetterText(letter Letter) string {
	parts := append([]string{}, letter.Recipient...)
	parts = append(parts, letter.Title, letter.Subject, letter.Salutation)
	for _, fact := range letter.Facts {
		parts = append(parts, fact.Label+": "+fact.Value)
	}
	for _, block := range letter.Blocks {
		parts = append(parts, block.Heading, block.Text)
		for _, fact := range block.Facts {
			parts = append(parts, fact.Label+" = "+fact.Value)
		}
		if code := block.PaymentCode; code != nil {
			parts = append(parts, code.Heading, code.Text)
		}
	}
	return strings.Join(nonBlank(append(parts, letter.Closing...)...), "\n") + "\n"
}

// addresseeHolidayContent is the golden holiday invoice for the recipient,
// written with the standard template of documentKind.
func addresseeHolidayContent(t *testing.T, recipient addresseeRecipient, documentKind string) letterContent {
	t.Helper()
	content := goldenLetterContent(t)
	document := &content.document
	document.DocumentKind, document.DebtorNumber = documentKind, "10234"
	document.RecipientKind, document.RecipientFirstName, document.RecipientLastName = recipient.kind, recipient.firstName, recipient.lastName
	document.RecipientSecondName, document.RecipientAddress = recipient.secondName, recipient.address
	// The notes are the Träger's own text and stay out of the form check.
	content.input.Notes = "Frühstück, Wechselkleidung, Hausschuhe."
	if documentKind == parentbilling.DocumentKindFeeNotice {
		content.letterhead.Template.LegalRemedy = "Gegen diesen Bescheid ist Widerspruch möglich."
	}
	return content
}

// addresseeCorrection is a Storno or a Gutschrift of the golden invoice of
// documentKind.
func addresseeCorrection(t *testing.T, recipient addresseeRecipient, kind, documentKind string) letterContent {
	t.Helper()
	content := addresseeHolidayContent(t, recipient, documentKind)
	invoice := content.document
	document := creditOf(invoice, invoice.Children[1], parentbilling.BillingCreditInput{AmountCents: 2000, Reason: "Ausflug fiel aus"})
	if kind == parentbilling.DocumentCancellation {
		document = cancellationOf(invoice, "Anschrift falsch")
	}
	document.ID, document.Number, document.IssuedOn = 12, "FE-2026-0012", letterDate(t, "2026-12-20")
	content.document, content.invoice = document, &invoice
	content.leftCents = leftOf(invoice, []parentbilling.BillingDocument{document})
	return content
}

func addresseeDirectDebit() *parentbilling.InvoicePayment {
	return &parentbilling.InvoicePayment{
		Method: parentbilling.PaymentDirectDebit, DueOn: calendar.NewDate(2027, 1, 18), DueSource: parentbilling.DueFromRun,
		Mandate: &parentbilling.InvoiceMandate{MandateID: 9, Reference: "SJR-2026-0042", SignedOn: calendar.NewDate(2026, 9, 1),
			CreditorID: "DE98ZZZ09999999999", IBANMasked: "DE•• •••• •••• •••• ••30 00", SequenceType: parentbilling.SequenceTypeRecurring},
	}
}

func addresseeCareRecipient(recipient addresseeRecipient) parentbilling.CareRecipient {
	return parentbilling.CareRecipient{Kind: recipient.kind, FirstName: recipient.firstName, LastName: recipient.lastName,
		SecondName: recipient.secondName, Address: recipient.address}
}

func addresseeCareContent(recipient addresseeRecipient) careLetterContent {
	content := careLetterSJR()
	content.invoice.Recipient = addresseeCareRecipient(recipient)
	content.input.Notes = ""
	content.letterhead.ContactEmail = "abrechnung@example.org"
	return content
}

func addresseeCareCancellation(recipient addresseeRecipient) careLetterContent {
	content := addresseeCareContent(recipient)
	content.cancellation = &parentbilling.CareCancellation{ID: 8, InvoiceID: 7, Number: "MB-2027-0009",
		IssuedOn: calendar.NewDate(2027, 1, 20), Reason: "Vertrag endete im Dezember", TotalCents: -5401}
	return content
}

func addresseeCareNotice(recipient addresseeRecipient) careLetterContent {
	content := addresseeCareContent(recipient)
	content.invoice.DocumentKind, content.invoice.DebtorNumber = parentbilling.DocumentKindFeeNotice, "10234"
	content.letterhead.Template.LegalRemedy = "Gegen diesen Bescheid ist Widerspruch möglich."
	return content
}

func addresseeYearNotice(recipient addresseeRecipient) parentbilling.CareNotice {
	issued := calendar.NewDate(2030, 9, 24)
	return parentbilling.CareNotice{
		Number: "MB-2030-0001", IssuedOn: &issued, Kind: parentbilling.NoticeKindInitial, Year: 2030,
		ChildFirstName: "Mia", ChildLastName: "Beispiel", SchoolName: "Grundschule Ispringen",
		Recipient: addresseeCareRecipient(recipient), PaymentMethod: parentbilling.PaymentTransfer,
		PeriodFrom: calendar.NewDate(2030, 8, 1), PeriodUntil: calendar.NewDate(2031, 7, 31),
		Lines: []parentbilling.CareNoticeLine{{Kind: parentbilling.NoticeLineModule, Label: "Betreuung bis 16:30 Uhr", Detail: "Di",
			PeriodFrom: calendar.NewDate(2030, 8, 1), PeriodUntil: calendar.NewDate(2031, 7, 31), Months: 12, Quantity: 1,
			MonthlyCents: 4550, AnnualCents: 54600}},
		Installments: []parentbilling.CareNoticeInstallment{{Month: calendar.NewDate(2030, 8, 1), DueOn: calendar.NewDate(2030, 8, 1),
			AmountCents: 4550, ImmediatelyDue: true}},
		TotalCents: 54600, LegalRemedy: "Gegen diesen Bescheid ist Widerspruch möglich.",
	}
}
