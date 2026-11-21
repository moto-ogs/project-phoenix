package application

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

func transferAccount() *parentbilling.LetterheadBankAccount {
	return &parentbilling.LetterheadBankAccount{
		AccountHolder: "Ganztag im Quartier e.V.", IBAN: "de02 1203 0000 0000 2020 51", BIC: "byladem1001", BankName: "Beispielbank",
	}
}

// TestTransferCodeFollowsEPC069 is the golden test of the payload (#4818):
// EPC069-12 version 002, UTF-8, SEPA credit transfer, then BIC, the name
// and IBAN of the Träger, the amount in EUR and the reference to pay with.
// Purpose and structured reference stay empty; the trailing empty line of
// the information to the payer is left out, as the standard allows.
func TestTransferCodeFollowsEPC069(t *testing.T) {
	t.Parallel()

	code, ok := transferCode(letterAddressee{}, transferAccount(), "", 9250, "FE-2026-0007")
	require.True(t, ok)
	assert.Equal(t, "BCD\n002\n1\nSCT\nBYLADEM1001\nGanztag im Quartier e.V.\nDE02120300000000202051\nEUR92.50\n\n\nFE-2026-0007",
		code.Payload)
	assert.Equal(t, []LetterFact{
		{Label: "Empfänger", Value: "Ganztag im Quartier e.V."},
		{Label: "IBAN", Value: "DE02 1203 0000 0000 2020 51"},
		{Label: "Betrag", Value: "92,50 €"},
		{Label: "Verwendungszweck", Value: "FE-2026-0007"},
	}, code.Facts)
	assert.Equal(t, "Bezahlen per QR-Code", code.Heading)
	assert.Equal(t, "Scannt den Code mit eurer Banking-App und überweist.",
		code.Text)
}

// The amount is the total of the document in whole cents, never a float.
func TestTransferCodeAmountIsTheTotalInCents(t *testing.T) {
	t.Parallel()

	for cents, want := range map[int64]string{1: "EUR0.01", 5: "EUR0.05", 100: "EUR1.00", 123456: "EUR1234.56", 99999999999: "EUR999999999.99"} {
		code, ok := transferCode(letterAddressee{}, transferAccount(), "", cents, "R-1")
		require.True(t, ok, cents)
		assert.Equal(t, want, strings.Split(code.Payload, "\n")[7], cents)
	}
}

// Nothing to transfer, no account or more than a code can carry: no code.
func TestTransferCodeOnlyForAnAmountToTransfer(t *testing.T) {
	t.Parallel()

	for name, run := range map[string]func() (PaymentCode, bool){
		"zero":       func() (PaymentCode, bool) { return transferCode(letterAddressee{}, transferAccount(), "", 0, "R-1") },
		"negative":   func() (PaymentCode, bool) { return transferCode(letterAddressee{}, transferAccount(), "", -500, "R-1") },
		"no account": func() (PaymentCode, bool) { return transferCode(letterAddressee{}, nil, "", 500, "R-1") },
		"no IBAN": func() (PaymentCode, bool) {
			return transferCode(letterAddressee{}, &parentbilling.LetterheadBankAccount{AccountHolder: "X"}, "", 500, "R-1")
		},
		"too large": func() (PaymentCode, bool) {
			return transferCode(letterAddressee{}, transferAccount(), "", 100000000000, "R-1")
		},
		"no name": func() (PaymentCode, bool) {
			return transferCode(letterAddressee{}, &parentbilling.LetterheadBankAccount{IBAN: "DE02120300000000202051"}, "", 500, "R-1")
		},
		"no number": func() (PaymentCode, bool) { return transferCode(letterAddressee{}, transferAccount(), "", 500, " ") },
	} {
		_, ok := run()
		assert.False(t, ok, name)
	}
}

// Without an account holder the code names the Träger by the first line of
// its letterhead; a name or reference longer than the standard allows is
// cut at a character, never inside one.
func TestTransferCodeFallsBackToTheSenderAndKeepsTheLimits(t *testing.T) {
	t.Parallel()

	account := &parentbilling.LetterheadBankAccount{IBAN: "DE02120300000000202051"}
	code, ok := transferCode(letterAddressee{}, account, "Förderverein Ganztag", 500, "R-1")
	require.True(t, ok)
	lines := strings.Split(code.Payload, "\n")
	assert.Equal(t, "", lines[4], "BIC is optional in version 002")
	assert.Equal(t, "Förderverein Ganztag", lines[5])

	code, ok = transferCode(letterAddressee{}, account, strings.Repeat("a", 80), 500, strings.Repeat("u", 150))
	require.True(t, ok)
	lines = strings.Split(code.Payload, "\n")
	assert.Equal(t, strings.Repeat("a", 70), lines[5])
	assert.Equal(t, strings.Repeat("u", 140), lines[10])
}

// The whole payload keeps to the 331 bytes of EPC069-12: umlauts take two
// bytes, so a long reference is cut to the bytes left, at a character.
func TestTransferCodeKeepsThePayloadWithin331Bytes(t *testing.T) {
	t.Parallel()

	account := &parentbilling.LetterheadBankAccount{IBAN: "DE02120300000000202051", BIC: "BYLADEM1001"}
	code, ok := transferCode(letterAddressee{}, account, strings.Repeat("ä", 80), 500, strings.Repeat("ü", 150))
	require.True(t, ok)
	assert.LessOrEqual(t, len(code.Payload), 331)
	lines := strings.Split(code.Payload, "\n")
	assert.Equal(t, strings.Repeat("ä", 70), lines[5])
	assert.True(t, utf8.ValidString(lines[10]), "cut at a character")
	left := 331 - len(strings.Join(lines[:10], "\n")) - 1
	assert.Contains(t, []int{left - 1, left}, len(lines[10]), "the reference keeps the bytes left, less one when a two-byte ü would not fit")
	assert.Equal(t, code.Facts[3].Value, lines[10], "the letter prints the reference the code carries")
}

// A BIC that is not 8 or 11 letters and digits stays out of the code;
// version 002 allows that, and the app finds the bank by the IBAN.
func TestTransferCodeLeavesOutAnUnusableBIC(t *testing.T) {
	t.Parallel()

	for bic, want := range map[string]string{"byladem1001": "BYLADEM1001", "COBADEFF": "COBADEFF", "BYLA DEM1001": "", "BYLADEM10": "", "": ""} {
		account := &parentbilling.LetterheadBankAccount{AccountHolder: "X", IBAN: "DE02120300000000202051", BIC: bic}
		code, ok := transferCode(letterAddressee{}, account, "", 500, "R-1")
		require.True(t, ok)
		assert.Equal(t, want, strings.Split(code.Payload, "\n")[4], bic)
	}
}

// A name with a line break or tabs stays one line: a break would shift
// every later field of the code, the IBAN into the place of the amount.
func TestTransferCodeKeepsTheNameOnOneLine(t *testing.T) {
	t.Parallel()

	account := &parentbilling.LetterheadBankAccount{AccountHolder: " Förderverein\nGanztag\t e.V. ", IBAN: "DE02120300000000202051"}
	code, ok := transferCode(letterAddressee{}, account, "", 500, "R-1")
	require.True(t, ok)
	lines := strings.Split(code.Payload, "\n")
	require.Len(t, lines, 11)
	assert.Equal(t, "Förderverein Ganztag e.V.", lines[5])
	assert.Equal(t, "DE02120300000000202051", lines[6])
	assert.Equal(t, "EUR5.00", lines[7])
}
