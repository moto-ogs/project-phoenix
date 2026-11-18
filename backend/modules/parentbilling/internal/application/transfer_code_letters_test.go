package application

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// paymentCodes are the transfer codes a letter prints, with the index of
// the block that carries each.
func paymentCodes(letter Letter) (codes []PaymentCode, at []int) {
	for i, block := range letter.Blocks {
		if block.PaymentCode != nil {
			codes, at = append(codes, *block.PaymentCode), append(at, i)
		}
	}
	return codes, at
}

// remittance is the reference to pay with a code carries.
func remittance(code PaymentCode) string {
	lines := strings.Split(code.Payload, "\n")
	return lines[len(lines)-1]
}

func amountOf(code PaymentCode) string {
	return strings.Split(code.Payload, "\n")[7]
}

// The holiday invoice paid by transfer carries one code: the total of the
// document, the number as the reference, right after the payment text.
func TestHolidayInvoiceByTransferCarriesTheTransferCode(t *testing.T) {
	t.Parallel()

	for _, kind := range []string{parentbilling.DocumentKindConfirmation, parentbilling.DocumentKindInvoice} {
		content := goldenLetterContent(t)
		content.document.DocumentKind = kind
		content.document.Payment = &parentbilling.InvoicePayment{Method: parentbilling.PaymentTransfer, DueOn: calendar.NewDate(2026, 12, 15)}
		letter := confirmationLetter(content)

		codes, at := paymentCodes(letter)
		require.Len(t, codes, 1, kind)
		assert.True(t, letter.OnePage, "the code keeps the letter on one page")
		assert.Equal(t, "EUR92.50", amountOf(codes[0]), "the total of 9250 cents")
		assert.Equal(t, "FE-2026-0007", remittance(codes[0]))
		require.Positive(t, at[0], kind)
		assert.Contains(t, letter.Blocks[at[0]-1].Text, "Bitte überweist 92,50 €", "the code follows the payment text")
	}
}

// An invoice issued before #4689 has no payment of its own and is paid by
// transfer; its letter, created now, carries the code as well.
func TestHolidayInvoiceWithoutPaymentMethodIsATransfer(t *testing.T) {
	t.Parallel()

	codes, _ := paymentCodes(confirmationLetter(goldenLetterContent(t)))
	require.Len(t, codes, 1)
}

// The reference to pay with names the debtor number the Träger matches the
// payment by: the Buchungszeichen of a notice, the Debitorennummer of an
// invoice.
func TestTransferCodeNamesTheBuchungszeichenOfANotice(t *testing.T) {
	t.Parallel()

	notice := noticeContent(t)
	letter := confirmationLetter(notice)
	codes, _ := paymentCodes(letter)
	require.Len(t, codes, 1)
	assert.False(t, letter.OnePage, "a fee notice keeps its full type")
	assert.Equal(t, "GB-2026-0007 Buchungszeichen 5.0311.000123.4", remittance(codes[0]))

	invoice := goldenLetterContent(t)
	invoice.document.DocumentKind = parentbilling.DocumentKindInvoice
	invoice.document.DebtorNumber = "10442"
	codes, _ = paymentCodes(confirmationLetter(invoice))
	require.Len(t, codes, 1)
	assert.Equal(t, "FE-2026-0007 Debitorennummer 10442", remittance(codes[0]))
}

// Direct debit, nothing to pay, a Storno and a Gutschrift carry no code.
func TestNoTransferCodeWithoutAnAmountToTransfer(t *testing.T) {
	t.Parallel()

	debit := goldenLetterContent(t)
	debit.document.Payment = &parentbilling.InvoicePayment{Method: parentbilling.PaymentDirectDebit, DueOn: calendar.NewDate(2026, 12, 15)}
	free := goldenLetterContent(t)
	free.document.TotalCents = 0
	free.document.Children = nil

	for name, letter := range map[string]Letter{
		"direct debit":      confirmationLetter(debit),
		"0 €":               confirmationLetter(free),
		"Storno":            cancellationLetter(correctionContent(t, parentbilling.DocumentCancellation)),
		"Gutschrift":        creditLetter(correctionContent(t, parentbilling.DocumentCredit)),
		"care direct debit": careInvoiceLetter(sepaInvoice()),
		"care 0 €":          careInvoiceLetter(freeCareInvoice()),
		"care Storno":       careCancellationLetter(cancelledCareInvoice()),
	} {
		codes, _ := paymentCodes(letter)
		assert.Empty(t, codes, name)
		assert.False(t, letter.OnePage, "%s keeps its type size", name)
	}
}

func freeCareInvoice() careLetterContent {
	content := careLetterSJR()
	content.invoice.TotalCents = 0
	return content
}

func cancelledCareInvoice() careLetterContent {
	content := careLetterSJR()
	content.cancellation = &parentbilling.CareCancellation{InvoiceID: content.invoice.ID, Number: "MB-2027-0009",
		IssuedOn: calendar.NewDate(2027, 1, 20), Reason: "Vertrag beendet", TotalCents: -content.invoice.TotalCents}
	return content
}

// The monthly invoice and its fee notice carry the code after the payment
// text, with the total of the month.
func TestMonthlyInvoiceAndNoticeCarryTheTransferCode(t *testing.T) {
	t.Parallel()

	letter := careInvoiceLetter(careLetterSJR())
	codes, at := paymentCodes(letter)
	require.Len(t, codes, 1)
	assert.Equal(t, "EUR54.01", amountOf(codes[0]))
	assert.Equal(t, "MB-2027-0001", remittance(codes[0]))
	assert.Contains(t, letter.Blocks[at[0]-1].Text, "Bitte überweist 54,01 €")

	notice := careLetterSJR()
	notice.invoice.DocumentKind = parentbilling.DocumentKindFeeNotice
	notice.invoice.DebtorNumber = "5.0311.000123.4"
	notice.letterhead.Template = hardtNoticeTemplate()
	letter = careNoticeLetter(notice)
	codes, at = paymentCodes(letter)
	require.Len(t, codes, 1)
	assert.Equal(t, "MB-2027-0001 Buchungszeichen 5.0311.000123.4", remittance(codes[0]))
	assert.Contains(t, letter.Blocks[at[0]-1].Text, "Bitte überweist 54,01 €")
	assert.NotEqual(t, legalRemedyHeading, letter.Blocks[at[0]].Heading, "the legal remedy stays last")
	assert.False(t, letter.OnePage, "a fee notice keeps its full type")
}

// A Träger that switched the GiroCode off (#5624) gets no code on any
// letter it pays by transfer: confirmation, holiday invoice, fee notice,
// monthly invoice and monthly fee notice. The payment text stays.
func TestNoTransferCodeWhenTheTraegerSwitchedItOff(t *testing.T) {
	t.Parallel()

	// Each letter on the same fixture with the switch on and off: on prints
	// exactly one code, so the off case cannot pass by a fixture that
	// never had one.
	letters := map[string]func(withoutCode bool) Letter{
		"confirmation": func(withoutCode bool) Letter {
			content := goldenLetterContent(t)
			content.letterhead.WithoutTransferCode = withoutCode
			return confirmationLetter(content)
		},
		"holiday invoice": func(withoutCode bool) Letter {
			content := goldenLetterContent(t)
			content.document.DocumentKind = parentbilling.DocumentKindInvoice
			content.letterhead.WithoutTransferCode = withoutCode
			return confirmationLetter(content)
		},
		"fee notice": func(withoutCode bool) Letter {
			content := noticeContent(t)
			content.letterhead.WithoutTransferCode = withoutCode
			return confirmationLetter(content)
		},
		"care invoice": func(withoutCode bool) Letter {
			content := careLetterSJR()
			content.letterhead.WithoutTransferCode = withoutCode
			return careInvoiceLetter(content)
		},
		"care fee notice": func(withoutCode bool) Letter {
			content := careLetterSJR()
			content.invoice.DocumentKind = parentbilling.DocumentKindFeeNotice
			content.invoice.DebtorNumber = "5.0311.000123.4"
			content.letterhead.Template = hardtNoticeTemplate()
			content.letterhead.WithoutTransferCode = withoutCode
			return careNoticeLetter(content)
		},
	}
	for name, letter := range letters {
		on, _ := paymentCodes(letter(false))
		assert.Len(t, on, 1, "%s prints the code while the switch is on", name)
		off := letter(true)
		codes, _ := paymentCodes(off)
		assert.Empty(t, codes, name)
		assert.Contains(t, letterText(off), "Bitte überweis", "%s keeps the payment text", name)
	}
}
