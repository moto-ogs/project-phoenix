package listexport

import (
	"bytes"
	"slices"
	"strings"
	"testing"

	listrecords "github.com/moto-ogs/project-phoenix/modules/documentrendering/records"
)

const samplePayload = "BCD\n002\n1\nSCT\nBYLADEM1001\nFörderverein Ganztag e.V.\nDE02120300000000202051\nEUR92.50\n\n\nFE-2026-0007 Buchungszeichen 5.0311.000123.4"

func samplePaymentCode() *listrecords.LetterPaymentCode {
	return &listrecords.LetterPaymentCode{
		Payload: samplePayload,
		Heading: "Bezahlen per QR-Code",
		Text:    "Mit der Banking-App scannen und überweisen.",
		Facts: []listrecords.LetterFact{
			{Label: "IBAN", Value: "DE02 1203 0000 0000 2020 51"},
			{Label: "Betrag", Value: "92,50 €"},
		},
	}
}

// letterWithPaymentCode is the sample letter with the code after the
// paragraph of the total.
func letterWithPaymentCode() listrecords.Letter {
	letter := sampleLetter()
	letter.Blocks = slices.Insert(letter.Blocks, 2, listrecords.LetterBlock{PaymentCode: samplePaymentCode()})
	return letter
}

// The payment code prints where its block stands, with its heading, text
// and facts beside the code, and the letter still fits one page.
func TestLetterPrintsThePaymentCodeWhereItsBlockStands(t *testing.T) {
	t.Parallel()

	pages, trace := traceLetter(t, letterWithPaymentCode())
	if pages != 1 {
		t.Fatalf("pages = %d, want 1", pages)
	}
	start := slices.Index(trace, "Gesamtbetrag")
	end := slices.Index(trace, "Bitte denken Sie an")
	if start < 0 || end < start {
		t.Fatalf("trace misses the blocks around the code: %q", trace)
	}
	want := []string{"Gesamtbetrag", "[QR-Code]", "Bezahlen per QR-Code", "Mit der Banking-App scannen und überweisen.",
		"IBAN", "DE02 1203 0000 0000 2020 51", "Betrag", "92,50 €"}
	if got := trace[start:end]; !slices.Equal(got, want) {
		t.Fatalf("around the code\n got %q\nwant %q", got, want)
	}
}

// A code that does not fit the rest of a page moves to the next page as a
// whole, never split from its words: with as many lines before it as page
// one holds beside the code, the code starts page two.
func TestPaymentCodeStaysInOnePiece(t *testing.T) {
	t.Parallel()

	for lines := 1; lines < 80; lines++ {
		letter := sampleLetter()
		letter.Closing = nil // only the code may start the next page
		for range lines {
			letter.Blocks = append(letter.Blocks, listrecords.LetterBlock{Text: "Eine Zeile Text, die Platz braucht."})
		}
		before := measuredLetter(t, letter)
		letter.Blocks = append(letter.Blocks, listrecords.LetterBlock{PaymentCode: samplePaymentCode()})
		after := measuredLetter(t, letter)
		if after.page == before.page {
			continue
		}
		height, err := after.paymentCodeHeight(*samplePaymentCode())
		if err != nil {
			t.Fatal(err)
		}
		if top := after.y - height - after.paragraph; top != letterNextTop {
			t.Fatalf("the code starts at %.1f on page %d, want the top %.1f", top, after.page, letterNextTop)
		}
		return
	}
	t.Fatal("the code never moved to the next page")
}

func measuredLetter(t *testing.T, letter listrecords.Letter) *letterLayout {
	t.Helper()
	chrome, err := newLetterChrome(letter.Title)
	if err != nil {
		t.Fatal(err)
	}
	layout, err := newLetterLayout(chrome, letter)
	if err != nil {
		t.Fatal(err)
	}
	if err := layout.run(); err != nil {
		t.Fatal(err)
	}
	return layout
}

// The rendered PDF holds the code as vector squares, not as an image.
func TestLetterWithPaymentCodeRenders(t *testing.T) {
	t.Parallel()

	data, err := renderLetterPDF(letterWithPaymentCode())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(data, []byte("%PDF")) {
		t.Fatal("not a PDF")
	}
	if strings.Contains(string(data), "/Subtype /Image") {
		t.Fatal("the code is drawn as an image")
	}
}

// A payload too long for a QR code fails the letter instead of printing a
// code no app can read.
func TestPaymentCodeRefusesAnUnencodablePayload(t *testing.T) {
	t.Parallel()

	letter := letterWithPaymentCode()
	letter.Blocks[2].PaymentCode.Payload = strings.Repeat("x", 3000)
	if _, err := renderLetterPDF(letter); err == nil {
		t.Fatal("rendered a letter with an unencodable payment code")
	}
}
