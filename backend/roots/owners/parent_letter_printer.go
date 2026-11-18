package owners

import (
	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
)

// The printed letters of an Elternbrief (#4813) are described in unnamed
// shapes by the announcement routes; this binding lays them out in Document
// Rendering's letter layout, one letter per child, and puts them into one
// PDF to print.
type (
	parentLetterFact  = struct{ Label, Value string }
	parentLetterSheet = struct {
		Logo       []byte
		Sender     []string
		Recipient  []string
		Facts      []parentLetterFact
		Subject    string
		Paragraphs []string
		Footer     []string
	}
	parentLetterSheets = struct {
		Title   string
		Letters []parentLetterSheet
	}
)

// ParentLetterPrinter renders the letters of a dispatch.
type ParentLetterPrinter struct {
	letters lists.LetterRenderer
}

// NewParentLetterPrinter binds the letter layout.
func NewParentLetterPrinter() ParentLetterPrinter {
	return ParentLetterPrinter{letters: lists.NewLetterRenderer()}
}

// PrintLetters renders each letter and combines them into one PDF.
func (p ParentLetterPrinter) PrintLetters(sheets parentLetterSheets, filenameBase string) (recordReportFile, error) {
	rendered := make([][]byte, 0, len(sheets.Letters))
	for _, sheet := range sheets.Letters {
		letter := lists.Letter{
			Title: sheets.Title, Logo: sheet.Logo, Sender: sheet.Sender, Recipient: sheet.Recipient,
			Subject: sheet.Subject, Footer: sheet.Footer, OnePage: true,
			Facts:  make([]lists.LetterFact, 0, len(sheet.Facts)),
			Blocks: make([]lists.LetterBlock, 0, len(sheet.Paragraphs)),
		}
		for _, fact := range sheet.Facts {
			letter.Facts = append(letter.Facts, lists.LetterFact{Label: fact.Label, Value: fact.Value})
		}
		for _, paragraph := range sheet.Paragraphs {
			letter.Blocks = append(letter.Blocks, lists.LetterBlock{Text: paragraph})
		}
		file, err := p.letters.RenderLetter(letter, filenameBase)
		if err != nil {
			return recordReportFile{}, err
		}
		rendered = append(rendered, file.Data)
	}
	file, err := p.letters.CombineLetters(rendered, sheets.Title, filenameBase)
	if err != nil {
		return recordReportFile{}, err
	}
	return recordReportFile{Data: file.Data, ContentType: file.ContentType, Filename: file.Filename}, nil
}
