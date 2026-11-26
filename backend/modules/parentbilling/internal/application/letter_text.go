package application

import (
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The text of the confirmation letter (#4669, ADR 0121). It follows the
// Bissendorf letter field by field (GH-003): the family in the address
// field, the date, the subject, the salutation, the confirmation naming
// the children, the total, the reference to pay with, the payment date,
// the bank account of the Träger, the free text of the run (packing list,
// rule on illness), the emergency numbers of the hosting OGS and whom to
// ask. The address field names the family and the person who registered,
// then the postal address the invoice copied from the registration when the
// form asked for it (ADR 0121 addendum, #5625). The reference to pay with is
// the debtor number of the family the invoice copied from the registration,
// the Bissendorf address number, and without one the invoice number (ADR
// 0121 addendum, #5621).

// Letter is a confirmation letter as the Elternabrechnung writes it: every
// text, in the parts of a letter. The LetterRenderer lays it out in the
// layout of the Träger.
type Letter struct {
	Title       string
	AccentColor string
	Logo        []byte
	Sender      []string
	Recipient   []string
	Facts       []LetterFact
	Subject     string
	Salutation  string
	Blocks      []LetterBlock
	Closing     []string
	Footer      []string
	// OnePage lets the renderer set the body in smaller type, down to 8
	// points, when that keeps the letter on one page (#4818). An invoice
	// with a transfer code sets it, so the code does not push the closing
	// lines onto a page of their own; a fee notice keeps its full type.
	OnePage bool
}

// LetterFact is a label with its value; Bold marks a total.
type LetterFact struct {
	Label string
	Value string
	Bold  bool
}

// LetterBlock is a paragraph of the body with an optional heading and an
// optional two-column table after it. A block with a PaymentCode prints
// the transfer code instead (#4818).
type LetterBlock struct {
	Heading     string
	Text        string
	Bold        bool
	Facts       []LetterFact
	PaymentCode *PaymentCode
}

// LetterRenderer lays out a letter as a PDF. The adapter binds it to
// Document Rendering; it stores nothing.
type LetterRenderer interface {
	RenderLetter(letter Letter, filenameBase string) (parentbilling.BillingLetterFile, error)
}

// letterContent is everything one letter prints. The letter of a
// cancellation or a credit also names its invoice and what the invoice
// still asks for after it (#4690).
type letterContent struct {
	run           parentbilling.BillingRun
	document      parentbilling.BillingDocument
	input         parentbilling.BillingLetterInput
	letterhead    parentbilling.Letterhead
	invoice       *parentbilling.BillingDocument
	leftCents     int64
	accountHolder string
}

// confirmationLetter writes the letter of one issued invoice in the kind of
// document its release froze (#4688): the address field, the facts and the
// footer come from the invoice and the letterhead; subject, salutation, body
// and closing come from the Träger's template of that kind, filled with the
// values of this invoice (#4677, ADR 0152). Without a template of its own
// the Träger writes with the standard template; the standard confirmation
// letter is the letter of ADR 0121. A fee notice prints the legal remedy of
// its template after the body, so no text of the template leaves it out.
func confirmationLetter(content letterContent) Letter {
	document, head := content.document, content.letterhead
	kind, to := templateKindOf(document.DocumentKind), documentAddressee(document)
	filled := templates.Fill(letterTemplate(head.Template, kind, to), letterValues(content))
	payment := paymentText(content)
	blocks := withTransferCode(letterBlocks(filled.Blocks), payment, transferCodeOf(to, head, document.Payment,
		document.TotalCents, documentReference(document.Number, document.DebtorNumber, document.DocumentKind)))
	blocks = withDirectDebitNotice(blocks, payment, document.Payment, document.TotalCents)
	if kind != templates.KindConfirmation {
		if notes := strings.TrimSpace(content.input.Notes); notes != "" {
			blocks = append(blocks, LetterBlock{Heading: "Hinweise", Text: notes})
		}
		if len(content.input.EmergencyContacts) > 0 {
			facts := make([]LetterFact, 0, len(content.input.EmergencyContacts))
			for _, contact := range content.input.EmergencyContacts {
				facts = append(facts, LetterFact{Label: contact.Name, Value: contact.Phone})
			}
			blocks = append(blocks, LetterBlock{Heading: "Notfallnummern",
				Text: to.say("In dringenden Fällen und wenn euer Kind krank ist, erreicht ihr die Betreuung hier:",
					"In dringenden Fällen und wenn das Kind krank ist, erreichst du die Betreuung hier:"), Facts: facts})
		}
	}
	blocks = append(blocks, legalRemedyBlocks(filled.LegalRemedy)...)
	return Letter{
		OnePage:     kind != templates.KindFeeNotice && carriesPaymentCode(blocks),
		Title:       documentTitle(document.DocumentKind) + " " + document.Number,
		AccentColor: head.AccentColor,
		Logo:        head.Logo,
		Sender:      textLines(head.SenderText),
		Recipient:   recipientLines(document),
		Facts:       letterFacts(content),
		Subject:     filled.Subject,
		Salutation:  filled.Salutation,
		Blocks:      blocks,
		Closing:     filled.Closing,
		Footer:      nonBlank(append(textLines(head.FooterText), bankLine(head.BankAccount))...),
	}
}

// templateKindOf is the kind of template a kind of document is written
// with; an invoice issued before #4688 is a confirmation letter.
func templateKindOf(documentKind string) templates.Kind {
	switch documentKind {
	case parentbilling.DocumentKindInvoice:
		return templates.KindInvoice
	case parentbilling.DocumentKindFeeNotice:
		return templates.KindFeeNotice
	}
	return templates.KindConfirmation
}

// documentTitle names a kind of document in the title of its letter.
func documentTitle(documentKind string) string {
	switch documentKind {
	case parentbilling.DocumentKindInvoice:
		return "Rechnung"
	case parentbilling.DocumentKindFeeNotice:
		return "Gebührenbescheid"
	}
	return "Bestätigung und Rechnung"
}

// legalRemedyHeading heads the legal remedy when the Träger's text starts
// without a heading of its own.
const legalRemedyHeading = "Rechtsbehelfsbelehrung"

// legalRemedyBlocks prints the legal remedy of a fee notice under its
// heading (#4688).
func legalRemedyBlocks(blocks []templates.Block) []LetterBlock {
	result := letterBlocks(blocks)
	if len(result) > 0 && strings.TrimSpace(result[0].Heading) == "" {
		result[0].Heading = legalRemedyHeading
	}
	return result
}

// letterTemplate is the Träger's template, or the standard one of kind
// while the letterhead carries none. The standard text speaks to the
// addressee: to one person in the du-form, greeting them by name (ADR
// 0294, #7463). A Träger without a template of its own gets the standard
// text from Document Templates, and one may save it unchanged, so a
// template with the standard text counts as standard too; it keeps its
// table layout and legal remedy. A Träger's own wording stays (#7462).
func letterTemplate(template parentbilling.LetterTemplate, kind templates.Kind, to letterAddressee) templates.Template {
	if strings.TrimSpace(template.Body) == "" {
		return standardTemplate(kind, to, templates.InvoiceLayout{}, template.LegalRemedy)
	}
	own := templates.Template{
		Subject: template.Subject, Salutation: template.Salutation, Body: template.Body, Closing: template.Closing,
		Invoice: invoiceLayout(template), LegalRemedy: template.LegalRemedy,
	}
	if to.one && sameText(own, templates.Default(kind)) {
		return standardTemplate(kind, to, own.Invoice, own.LegalRemedy)
	}
	return own
}

// standardTemplate is the standard template of kind for the addressee.
func standardTemplate(kind templates.Kind, to letterAddressee, layout templates.InvoiceLayout, legalRemedy string) templates.Template {
	standard := templates.Default(kind)
	if to.one {
		standard = templates.DefaultForOne(kind)
		standard.Salutation = to.salutation
	}
	standard.Invoice, standard.LegalRemedy = layout, legalRemedy
	return standard
}

// sameText reports whether two templates have the same text.
func sameText(a, b templates.Template) bool {
	a, b = templates.Normalize(a), templates.Normalize(b)
	return a.Subject == b.Subject && a.Salutation == b.Salutation && a.Body == b.Body && a.Closing == b.Closing
}

func invoiceLayout(template parentbilling.LetterTemplate) templates.InvoiceLayout {
	return templates.InvoiceLayout{GroupByChild: template.GroupByChild, HideTimeModels: template.HideTimeModels}
}

// letterValues are the values of every placeholder of the confirmation
// letter for one invoice, with the table of amounts in the layout of the
// Träger's template (#5691).
func letterValues(content letterContent) map[string]templates.Value {
	document, head := content.document, content.letterhead
	layout, to := invoiceLayout(head.Template), documentAddressee(content.document)
	text := func(value string) templates.Value { return templates.Value{Text: strings.TrimSpace(value)} }
	values := map[string]templates.Value{
		"familienname":    text(document.RecipientLastName),
		"anmelder":        text(fullName(document.RecipientFirstName, document.RecipientLastName)),
		"kinder":          text(childNames(document.Children)),
		"traeger":         text(firstLine(textLines(head.SenderText))),
		"ansprechperson":  text(head.ContactName),
		"rueckfragen":     text(questionText(head, to)),
		"zeitraum":        text(content.run.PeriodName),
		"rechnungsnummer": text(document.Number),
		"bescheidnummer":  text(document.Number),
		"debitorennummer": text(document.DebtorNumber),
		"positionen":      {Rows: templates.InvoiceRows(layout, invoiceChildren(document), formatEuro(document.TotalCents))},
		"summe":           text(formatEuro(document.TotalCents)),
		"zahlungshinweis": text(paymentText(content)),
		"hinweise":        text(content.input.Notes),
		"notfallnummern":  {Rows: emergencyRows(content.input.EmergencyContacts)},
	}
	values["datum"], values["zahlen_bis"] = templates.Value{}, templates.Value{}
	if document.IssuedOn != nil {
		values["datum"] = text(germanDate(*document.IssuedOn))
	}
	if document.TotalCents > 0 {
		values["zahlen_bis"] = text(germanDate(dueOnOf(document.Payment, content.input.PaymentDueOn)))
	}
	return values
}

// missingLetterValuesOf names the placeholders of a kind of template the
// letter writes no value for (#4688). Every placeholder its kind offers the
// Träger must have one, even an empty one, or a paragraph of the Träger's
// template would vanish without a reason.
func missingLetterValuesOf(kind templates.Kind, values map[string]templates.Value) []string {
	var missing []string
	for _, placeholder := range templates.Placeholders(kind) {
		if _, ok := values[placeholder.Name]; !ok {
			missing = append(missing, placeholder.Name)
		}
	}
	return missing
}

func emergencyRows(contacts []parentbilling.BillingEmergencyContact) []templates.Row {
	result := make([]templates.Row, len(contacts))
	for i, contact := range contacts {
		result[i] = templates.Row{Label: contact.Name, Value: contact.Phone}
	}
	return result
}

func letterBlocks(blocks []templates.Block) []LetterBlock {
	result := make([]LetterBlock, len(blocks))
	for i, block := range blocks {
		var facts []LetterFact
		for _, row := range block.Rows {
			facts = append(facts, LetterFact(row))
		}
		result[i] = LetterBlock{Heading: block.Heading, Text: block.Text, Bold: block.Bold, Facts: facts}
	}
	return result
}

// recipientLines are the lines of the address field: the family, the
// person who registered and, when the invoice has one, the street and the
// postal code with the city.
func recipientLines(document parentbilling.BillingDocument) []string {
	return billingRecipientLines(document.RecipientKind, document.RecipientFirstName, document.RecipientLastName,
		document.RecipientSecondName, document.RecipientAddress)
}

func letterFacts(content letterContent) []LetterFact {
	kind := templateKindOf(content.document.DocumentKind)
	facts := []LetterFact{{Label: numberLabel(content.document.DocumentKind), Value: content.document.Number}}
	if number := strings.TrimSpace(content.document.DebtorNumber); number != "" {
		facts = append(facts, LetterFact{Label: templates.DebtorNumberLabel(kind), Value: number})
	}
	if content.document.IssuedOn != nil {
		facts = append(facts, LetterFact{Label: "Datum", Value: germanDate(*content.document.IssuedOn)})
	}
	if content.document.TotalCents > 0 {
		facts = append(facts, paymentFacts(content.document.Payment, content.input.PaymentDueOn)...)
	}
	head := content.letterhead
	for _, fact := range []LetterFact{
		{Label: "Ansprechperson", Value: head.ContactName},
		{Label: "Telefon", Value: head.ContactPhone},
		{Label: "E-Mail", Value: head.ContactEmail},
	} {
		if strings.TrimSpace(fact.Value) != "" {
			facts = append(facts, fact)
		}
	}
	return facts
}

// numberLabel names the number of a document beside the address field.
func numberLabel(documentKind string) string {
	if documentKind == parentbilling.DocumentKindFeeNotice {
		return "Bescheidnummer"
	}
	return "Rechnungsnummer"
}

// invoiceChildren are the positions of the invoice by child with the
// child's subtotal; the template's layout prints them (#5691).
func invoiceChildren(document parentbilling.BillingDocument) []templates.InvoiceChild {
	children := make([]templates.InvoiceChild, 0, len(document.Children))
	for _, child := range document.Children {
		lines := make([]templates.InvoiceLine, 0, len(child.Positions))
		var subtotal int64
		for _, position := range child.Positions {
			line := invoiceLine(position)
			line.Amount = formatEuro(position.AmountCents)
			lines = append(lines, line)
			subtotal += position.AmountCents
		}
		children = append(children, templates.InvoiceChild{Name: strings.TrimSpace(child.FirstName), Lines: lines, Subtotal: formatEuro(subtotal)})
	}
	return children
}

// invoiceLine names a position: a booking by its week and time model,
// every other position by a text every layout prints.
func invoiceLine(position parentbilling.BillingPosition) templates.InvoiceLine {
	switch position.Kind {
	case parentbilling.LineSibling:
		return templates.InvoiceLine{Text: "Ermäßigung für Geschwister"}
	case parentbilling.LineBenefitsExemption:
		return templates.InvoiceLine{Text: "Befreiung bei Leistungsbezug"}
	case parentbilling.LineCostTakeover:
		return templates.InvoiceLine{Text: "Kosten übernimmt: " + strings.TrimSpace(position.CostBearerName)}
	case parentbilling.LineCorrection:
		return templates.InvoiceLine{Text: "Korrektur: " + strings.TrimSpace(position.Note)}
	}
	line := templates.InvoiceLine{TimeModel: strings.TrimSpace(position.TimeModelName)}
	if position.Kind == parentbilling.LineMeal {
		line.TimeModel = mealLabel(position)
	}
	if position.WeekStartsOn != nil && position.WeekEndsOn != nil {
		line.Week = fmt.Sprintf("Woche %s bis %s", position.WeekStartsOn.Format("02.01."), germanDate(*position.WeekEndsOn))
	}
	return line
}

// mealLabel names the lunch of a week with its number of lunches and the
// price of one (#5631): "Mittagessen, 5 Essen zu je 4,30 €". A position
// without the number names the lunch only.
func mealLabel(position parentbilling.BillingPosition) string {
	if position.BookedDays == nil || *position.BookedDays <= 0 {
		return "Mittagessen"
	}
	lunches := int64(*position.BookedDays)
	price := position.AmountCents / lunches
	if price < 0 {
		price = -price
	}
	if lunches == 1 {
		return "Mittagessen, 1 Essen zu " + formatEuro(price)
	}
	return fmt.Sprintf("Mittagessen, %d Essen für %s pro Essen", lunches, formatEuro(price))
}

// positionLabel names a position in one line, as the letters of a
// cancellation or a credit list it: the text of the position or its week
// with its time model.
func positionLabel(position parentbilling.BillingPosition) string {
	line := invoiceLine(position)
	if line.Text != "" {
		return line.Text
	}
	return strings.Join(nonBlank(line.Week, line.TimeModel), ", ")
}

// The placeholders of the payment text of a Träger (#5622). The settings
// registry admits exactly these four (parent_billing.payment_text).
const (
	placeholderAmount        = "{Betrag}"
	placeholderPaymentDueOn  = "{Zahlungsfrist}"
	placeholderInvoiceNumber = "{Rechnungsnummer}"
	placeholderDebtorNumber  = "{Debitorennummer}"
)

// paymentText asks for the transfer. A Träger's own payment text replaces
// the built-in sentence with its placeholders filled in (ADR 0121 addendum,
// #5622); an invoice of 0 € keeps the fixed sentence, which names the cost
// bearer when one takes the costs over (#5627). The reference to pay with of
// the built-in sentence is the debtor number of the family when the invoice
// has one (ADR 0121 addendum, #5621), otherwise the invoice number.
func paymentText(content letterContent) string {
	document, to := content.document, documentAddressee(content.document)
	if document.TotalCents == 0 {
		if bearer := costBearerName(document); bearer != "" {
			return to.say("Ihr müsst nichts bezahlen.", "Du musst nichts bezahlen.") + " Die Kosten übernimmt: " + bearer + "."
		}
		return to.say("Ihr müsst für diese Betreuung nichts bezahlen.", "Du musst für diese Betreuung nichts bezahlen.")
	}
	due := dueOnOf(document.Payment, content.input.PaymentDueOn)
	// reference names what to pay with, owner its article or possessive.
	reference, owner := "Rechnungsnummer "+document.Number, "die"
	if document.DocumentKind == parentbilling.DocumentKindFeeNotice {
		// A fee notice names its number and Buchungszeichen as such (#4688).
		reference = "Bescheidnummer " + document.Number
	}
	if number := strings.TrimSpace(document.DebtorNumber); number != "" {
		reference, owner = "Debitorennummer "+number, to.say("eure", "deine")
		if document.DocumentKind == parentbilling.DocumentKindFeeNotice {
			reference, owner = "Buchungszeichen "+number, to.say("euer", "dein")
		}
	}
	if isDirectDebit(document.Payment) {
		return directDebitText(to, document.TotalCents, due, reference,
			paymentMandate(document.Payment), content.accountHolder,
			fullName(document.RecipientFirstName, document.RecipientLastName),
			secondLetterRecipient(document.RecipientKind, document.RecipientSecondName))
	}
	if text := strings.TrimSpace(content.letterhead.PaymentText); text != "" {
		return strings.NewReplacer(
			placeholderAmount, formatEuro(document.TotalCents),
			placeholderPaymentDueOn, germanDate(due),
			placeholderInvoiceNumber, document.Number,
			placeholderDebtorNumber, strings.TrimSpace(document.DebtorNumber),
		).Replace(text)
	}
	return fmt.Sprintf(to.say("Bitte überweist %s bis zum %s auf das Konto unten. Gebt als Verwendungszweck %s an.",
		"Bitte überweise %s bis zum %s auf das Konto unten. Gib als Verwendungszweck %s an."),
		formatEuro(document.TotalCents), germanDate(due), owner+" "+reference)
}

// costBearerName is the name of the cost bearer of the first cost takeover
// of the invoice, or empty without one.
func costBearerName(document parentbilling.BillingDocument) string {
	for _, child := range document.Children {
		for _, position := range child.Positions {
			if position.Kind == parentbilling.LineCostTakeover {
				return strings.TrimSpace(position.CostBearerName)
			}
		}
	}
	return ""
}

// questionText says whom the addressee asks.
func questionText(head parentbilling.Letterhead, to letterAddressee) string {
	name := strings.TrimSpace(head.ContactName)
	ways := nonBlank(head.ContactPhone, head.ContactEmail)
	switch {
	case name == "" && len(ways) == 0:
		return ""
	case name == "":
		return to.say("Bei Fragen erreicht ihr uns unter ", "Bei Fragen erreichst du uns unter ") + strings.Join(ways, " oder ") + "."
	case len(ways) == 0:
		return to.say("Bei Fragen hilft euch ", "Bei Fragen hilft dir ") + name + "."
	}
	return to.say("Bei Fragen erreicht ihr ", "Bei Fragen erreichst du ") + name + " unter " + strings.Join(ways, " oder ") + "."
}

func bankLine(account *parentbilling.LetterheadBankAccount) string {
	if account == nil {
		return ""
	}
	parts := nonBlank(account.AccountHolder, "IBAN "+groupIBAN(account.IBAN))
	if bic := strings.TrimSpace(account.BIC); bic != "" {
		parts = append(parts, "BIC "+bic)
	}
	return "Bankverbindung: " + strings.Join(append(parts, nonBlank(account.BankName)...), " · ")
}

// groupIBAN prints an IBAN in groups of four, as banks print it.
func groupIBAN(iban string) string {
	compact := strings.ToUpper(strings.ReplaceAll(iban, " ", ""))
	var groups []string
	for len(compact) > 4 {
		groups = append(groups, compact[:4])
		compact = compact[4:]
	}
	return strings.Join(append(groups, compact), " ")
}

// childNames joins the first names: "Lina", "Lina und Ben", "Lina, Ben
// und Mia".
func childNames(children []parentbilling.BillingChild) string {
	names := make([]string, 0, len(children))
	for _, child := range children {
		names = append(names, strings.TrimSpace(child.FirstName))
	}
	names = nonBlank(names...)
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " und " + names[len(names)-1]
}

// formatEuro prints cents as "1.234,50 €"; a discount keeps its minus.
func formatEuro(cents int64) string {
	return formatAmount(cents) + " €"
}

func germanDate(date calendar.Date) string {
	if date.IsZero() {
		return ""
	}
	return date.Format("02.01.2006")
}

func fullName(first, last string) string {
	return strings.TrimSpace(strings.TrimSpace(first) + " " + strings.TrimSpace(last))
}

func textLines(text string) []string {
	return nonBlank(strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")...)
}

func firstLine(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return lines[0]
}

func nonBlank(values ...string) []string {
	kept := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			kept = append(kept, value)
		}
	}
	return kept
}
