// Package rendering binds the renderers of the Elternabrechnung to Document
// Rendering: the confirmation letters to its letter layout (#4669, ADR 0121)
// and the overview of a run to its list renderer (#4672, ADR 0122). It
// translates the owner's values into the Document Rendering contract and
// stores nothing.
package rendering

import (
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling/internal/application"
)

// Renderer lays out the confirmation letters and the overview of a run.
type Renderer struct {
	letters lists.LetterRenderer
	tables  lists.Renderer
	// now stamps the creation time of an overview (#7104).
	now func() time.Time
}

var (
	_ application.LetterRenderer = (*Renderer)(nil)
	_ application.LetterCombiner = (*Renderer)(nil)
	_ application.TableRenderer  = (*Renderer)(nil)
)

// NewRenderer returns the renderer over Document Rendering; an overview
// carries the time of the real clock.
func NewRenderer() *Renderer {
	return &Renderer{letters: lists.NewLetterRenderer(), tables: lists.NewRenderer(), now: time.Now}
}

// RenderLetter renders one letter as a PDF.
func (r *Renderer) RenderLetter(letter application.Letter, filenameBase string) (parentbilling.BillingLetterFile, error) {
	blocks := make([]lists.LetterBlock, len(letter.Blocks))
	for i, block := range letter.Blocks {
		blocks[i] = lists.LetterBlock{Heading: block.Heading, Text: block.Text, Bold: block.Bold, Facts: facts(block.Facts),
			PaymentCode: paymentCode(block.PaymentCode)}
	}
	file, err := r.letters.RenderLetter(lists.Letter{
		Title: letter.Title, AccentColor: letter.AccentColor, Logo: letter.Logo, Sender: letter.Sender,
		Recipient: letter.Recipient, Facts: facts(letter.Facts), Subject: letter.Subject, Salutation: letter.Salutation,
		Blocks: blocks, Closing: letter.Closing, Footer: letter.Footer, OnePage: letter.OnePage,
	}, filenameBase)
	if errors.Is(err, lists.ErrLetterheadTooLong) {
		return parentbilling.BillingLetterFile{}, fmt.Errorf("%w: %w", parentbilling.ErrLetterheadTooLong, err)
	}
	if err != nil {
		return parentbilling.BillingLetterFile{}, err
	}
	return parentbilling.BillingLetterFile{Filename: file.Filename, ContentType: file.ContentType, Data: file.Data}, nil
}

// CombineLetters puts the stored letters of a run into one PDF to print
// (#4670).
func (r *Renderer) CombineLetters(letters [][]byte, title, filenameBase string) (parentbilling.BillingLetterFile, error) {
	file, err := r.letters.CombineLetters(letters, title, filenameBase)
	if errors.Is(err, lists.ErrNoLetters) {
		return parentbilling.BillingLetterFile{}, fmt.Errorf("%w: %w", parentbilling.ErrBillingLettersMissing, err)
	}
	if err != nil {
		return parentbilling.BillingLetterFile{}, err
	}
	return parentbilling.BillingLetterFile{Filename: file.Filename, ContentType: file.ContentType, Data: file.Data}, nil
}

func facts(values []application.LetterFact) []lists.LetterFact {
	translated := make([]lists.LetterFact, len(values))
	for i, value := range values {
		translated[i] = lists.LetterFact{Label: value.Label, Value: value.Value, Bold: value.Bold}
	}
	return translated
}

// paymentCode translates the transfer code of a letter (#4818); nil stays
// nil.
func paymentCode(code *application.PaymentCode) *lists.LetterPaymentCode {
	if code == nil {
		return nil
	}
	return &lists.LetterPaymentCode{Payload: code.Payload, Heading: code.Heading, Text: code.Text, Facts: facts(code.Facts)}
}
