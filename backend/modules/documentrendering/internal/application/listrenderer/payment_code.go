package listexport

// The payment code of a letter (#4818): a QR code to pay with in a framed
// panel across the body, the code on the left, a heading, a sentence and
// a short table on the right. The code is drawn as vector squares, so it
// prints sharp at any size (package qrmatrix encodes it). The
// panel never breaks across pages.

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/internal/domain/qrmatrix"
	listrecords "github.com/moto-ogs/project-phoenix/modules/documentrendering/records"
)

// Geometry of the panel in PDF points.
const (
	codePanelPad    = 10.0 // inner space of the frame; also the quiet zone of the code
	codePanelRadius = 6.0
	codeSize        = 72.0 // 25 mm, larger than the 2 cm EPC069-12 asks for
	codeTextGap     = 16.0 // space between code and words
	codeLabelW      = 84.0 // column of the labels of the facts
	codeHeadingSize = 10.5
	codeTextSize    = 9.0
	codeTextLine    = 11.5
	codeFactLabel   = 7.5
	codeFactLine    = 11.0
	codeGapAfter    = 5.0 // space between the sentence and the facts
	codeHeadingGap  = 2.0 // space below the heading
)

// codeWordsWidth is the width of the column beside the code.
func (l *letterLayout) codeWordsWidth() float64 {
	return l.contentWidth() - 2*codePanelPad - codeSize - codeTextGap
}

// paymentCodeWords wraps heading and text of a code into their column.
func (l *letterLayout) paymentCodeWords(code listrecords.LetterPaymentCode) (heading, text []string, err error) {
	width := l.codeWordsWidth()
	if err := l.setFont(styleBold, codeHeadingSize); err != nil {
		return nil, nil, err
	}
	heading = l.wrap(code.Heading, width)
	if err := l.setFont(styleNormal, codeTextSize); err != nil {
		return nil, nil, err
	}
	return heading, l.wrap(code.Text, width), nil
}

// paymentCodeFactValues wraps the value of each fact into its column; a
// value keeps at most two lines.
func (l *letterLayout) paymentCodeFactValues(facts []listrecords.LetterFact) ([][]string, error) {
	if err := l.setFont(styleNormal, codeTextSize); err != nil {
		return nil, err
	}
	values := make([][]string, len(facts))
	for i, fact := range facts {
		values[i] = l.wrapCapped(fact.Value, l.codeWordsWidth()-codeLabelW, 2)
	}
	return values, nil
}

// paymentCodeHeight is the height of the panel: the code or the words
// beside it, whichever is higher, inside the frame.
func (l *letterLayout) paymentCodeHeight(code listrecords.LetterPaymentCode) (float64, error) {
	heading, text, err := l.paymentCodeWords(code)
	if err != nil {
		return 0, err
	}
	values, err := l.paymentCodeFactValues(code.Facts)
	if err != nil {
		return 0, err
	}
	words := float64(len(heading))*codeTextLine + codeHeadingGap + float64(len(text))*codeTextLine
	if len(values) > 0 {
		words += codeGapAfter
	}
	for _, lines := range values {
		words += float64(max(len(lines), 1)) * codeFactLine
	}
	return max(codeSize, words) + 2*codePanelPad, nil
}

// writePaymentCode prints the panel of a code, on the next page when it
// does not fit this one.
func (l *letterLayout) writePaymentCode(code listrecords.LetterPaymentCode) error {
	modules, err := qrmatrix.Modules(code.Payload)
	if err != nil {
		return fmt.Errorf("letter payment code: %w", err)
	}
	height, err := l.paymentCodeHeight(code)
	if err != nil {
		return err
	}
	// The space after the panel may fall on the next page.
	if err := l.ensure(height); err != nil {
		return err
	}
	top := l.y
	if l.draw {
		if err := l.drawCodePanel(top, height, modules); err != nil {
			return err
		}
	}
	l.trace = append(l.trace, "[QR-Code]")
	if err := l.writeCodeWords(code, top+codePanelPad); err != nil {
		return err
	}
	l.y = top + height + l.paragraph
	return nil
}

// drawCodePanel draws the frame and the code, vertically centred.
func (l *letterLayout) drawCodePanel(top, height float64, modules [][]bool) error {
	l.pdf.SetLineWidth(0.6)
	l.setStroke(colorBorder)
	if err := l.pdf.Rectangle(letterMarginLeft, top, l.w-letterMarginRight, top+height, "D", codePanelRadius, 8); err != nil {
		return fmt.Errorf("letter payment code frame: %w", err)
	}
	x := letterMarginLeft + codePanelPad
	y := top + (height-codeSize)/2
	module := codeSize / float64(len(modules))
	l.setFill(colorBody)
	for row, line := range modules {
		// One rectangle per run of dark modules, a hair taller than a
		// row, so no viewer shows seams between the squares.
		for col := 0; col < len(line); col++ {
			if !line[col] {
				continue
			}
			run := col
			for run < len(line) && line[run] {
				run++
			}
			l.pdf.RectFromUpperLeftWithStyle(x+float64(col)*module, y+float64(row)*module, float64(run-col)*module, module+0.05, "F")
			col = run
		}
	}
	return nil
}

// writeCodeWords prints heading, text and facts beside the code.
func (l *letterLayout) writeCodeWords(code listrecords.LetterPaymentCode, y float64) error {
	x := letterMarginLeft + codePanelPad + codeSize + codeTextGap
	heading, text, err := l.paymentCodeWords(code)
	if err != nil {
		return err
	}
	if err := l.style(styleBold, codeHeadingSize, l.accent); err != nil {
		return err
	}
	for _, line := range heading {
		if err := l.emit(x, y+codeHeadingSize, line); err != nil {
			return err
		}
		y += codeTextLine
	}
	y += codeHeadingGap
	if err := l.style(styleNormal, codeTextSize, colorBody); err != nil {
		return err
	}
	for _, line := range text {
		if err := l.emit(x, y+codeTextSize, line); err != nil {
			return err
		}
		y += codeTextLine
	}
	return l.writeCodeFacts(code.Facts, x, y+codeGapAfter)
}

// writeCodeFacts prints each fact as a muted label and its value.
func (l *letterLayout) writeCodeFacts(facts []listrecords.LetterFact, x, y float64) error {
	values, err := l.paymentCodeFactValues(facts)
	if err != nil {
		return err
	}
	for i, fact := range facts {
		if err := l.style(styleNormal, codeFactLabel, colorMuted); err != nil {
			return err
		}
		if err := l.emit(x, y+codeTextSize, fact.Label); err != nil {
			return err
		}
		if err := l.style(styleNormal, codeTextSize, colorBody); err != nil {
			return err
		}
		lines := max(len(values[i]), 1)
		for j, line := range values[i] {
			if err := l.emit(x+codeLabelW, y+codeTextSize+float64(j)*codeFactLine, line); err != nil {
				return err
			}
		}
		y += float64(lines) * codeFactLine
	}
	return nil
}
