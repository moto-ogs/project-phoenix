package owners

import (
	"regexp"
	"strings"
	"testing"
)

// Each child's letter of a dispatch is one page (#4813), also when its text
// would run onto a second page in the normal type.
func TestParentLetterPrinterPrintsOnePagePerChild(t *testing.T) {
	t.Parallel()
	text := strings.Repeat("Am Freitag fahren wir mit der Gruppe in den Zoo. Bitte geben Sie Ihrem Kind etwas zu trinken mit. ", 34)
	sheet := parentLetterSheet{
		Sender: []string{"OGS Musterschule"}, Recipient: []string{"An die Eltern von", "Lina Muster"},
		Facts: []parentLetterFact{{Label: "Datum", Value: "15.11.2026"}}, Subject: "Ausflug",
		Paragraphs: []string{"Liebe Eltern von Lina,", text}, Footer: []string{"OGS Musterschule"},
	}
	file, err := NewParentLetterPrinter().PrintLetters(parentLetterSheets{Title: "Ausflug", Letters: []parentLetterSheet{sheet, sheet}}, "ausflug")
	if err != nil {
		t.Fatalf("PrintLetters: %v", err)
	}
	if pages := len(regexp.MustCompile(`/Type\s*/Page[^s]`).FindAll(file.Data, -1)); pages != 2 {
		t.Fatalf("pages = %d, want one per child", pages)
	}
}
