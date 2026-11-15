package parentbillinghttp

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Every list of the Elternabrechnung is exported as PDF, Excel or CSV
// (#4718). The export route reads the list through the same capability and
// right as the list, so the owner records a read of personal data in the
// same trail as the list (the mandate, the number, the share, the run); the
// file holds every row of the Träger, which the head names as „Alle
// Schulen“.

// billingListFilter is the head of a list of the whole Träger.
var billingListFilter = []string{common.ListSchoolLabel("")}

// newListTable is a list of the Elternabrechnung with its columns; a list
// with personal data carries the note on every page.
func newListTable(title, filename string, personal bool, columns ...common.ListColumn) common.ListTable {
	table := common.ListTable{Title: title, Filters: billingListFilter, Columns: columns, Rows: [][]string{}, Filename: filename}
	if personal {
		table.Footer = common.ListPersonalDataFooter
	}
	return table
}

// column is a list column by its ID and German label.
func column(id, label string) common.ListColumn {
	return common.ListColumn{ID: id, Label: label}
}

// Status labels as the pages name them.
var (
	runStatusLabels = map[string]string{
		capability.RunCalculated: "Vorschau", capability.RunReleased: "Freigegeben", capability.RunDiscarded: "Verworfen",
	}
	noticeRunStatusLabels = map[string]string{
		capability.RunCalculated: "Vorschau", capability.RunReleased: "Ausgestellt", capability.RunDiscarded: "Verworfen",
	}
	paymentMethodLabels = map[string]string{
		capability.PaymentTransfer: "Überweisung", capability.PaymentDirectDebit: "Lastschrift",
	}
)

// euroText is an amount in whole cent as „1.234,50 €“.
func euroText(cents int64) string {
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	euros := strconv.FormatInt(cents/100, 10)
	for i := len(euros) - 3; i > 0; i -= 3 {
		euros = euros[:i] + "." + euros[i:]
	}
	return fmt.Sprintf("%s%s,%02d €", sign, euros, cents%100)
}

// optionalEuro is an amount or „–“ without one.
func optionalEuro(cents *int64) string {
	if cents == nil {
		return "–"
	}
	return euroText(*cents)
}

// dateText is a day as „07.09.2026“.
func dateText(day calendar.Date) string {
	return day.Format("02.01.2006")
}

// optionalDate is a day or „–“ without one.
func optionalDate(day *calendar.Date) string {
	if day == nil {
		return "–"
	}
	return dateText(*day)
}

// periodText is „07.09.2026 bis 11.09.2026“.
func periodText(from, until calendar.Date) string {
	return dateText(from) + " bis " + dateText(until)
}

// instantText is a moment in Berlin time as „07.09.2026 14:05“.
func instantText(at *time.Time) string {
	if at == nil {
		return "–"
	}
	return at.In(calendar.Berlin).Format("02.01.2006 15:04")
}

// countText is a count with its word, or „noch nicht ausgestellt“ before
// the release.
func countText(count *int, one, many string) string {
	switch {
	case count == nil:
		return "noch nicht ausgestellt"
	case *count == 1:
		return "1 " + one
	default:
		return strconv.Itoa(*count) + " " + many
	}
}

// personName is „Vorname Nachname“.
func personName(first, last string) string {
	return strings.TrimSpace(first + " " + last)
}

// schoolCountText names how many schools a run holds.
func schoolCountText(schoolIDs []int64) string {
	switch len(schoolIDs) {
	case 0:
		return "–"
	case 1:
		return "1 Schule"
	default:
		return strconv.Itoa(len(schoolIDs)) + " Schulen"
	}
}
