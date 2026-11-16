package domain

import (
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
)

// The DATEV payroll files (#1417 2b): LODAS ASCII and Lohn und Gehalt ASCII.
// A school writes its month file with them, the Träger its file over all
// schools (#4712, ADR 0089 section 11); both serialize the same lines, so
// the two files can never differ in format.
//
// Format research (sources in the PR description of #1417 2b):
//   - LODAS ASCII is self-describing: [Allgemein] header with Berater-/
//     MandantenNr, [Satzbeschreibung] declaring the record layout against
//     DATEV's table fields, then [Bewegungsdaten]. The Schnittstellenhandbuch
//     requires ANSI encoding and CR/LF line ends.
//   - Lohn und Gehalt ASCII has no header block: the tax consultant creates
//     the Importbeschreibung themselves in the ASCII-Importassistent. We write
//     the widespread 11-field Bewegungsdaten layout (Personalnummer;
//     Kalendertag;Ausfallschlüssel;Lohnartennummer;Stundenanzahl;Tagesanzahl;
//     Wert;Abw. Faktor;Abw. Lohnveränderung;Kostenstelle;Kostenträger) with
//     one header row the import description can skip.
//
// Encoding for both: Windows-1252 ("ANSI"), CR/LF, no BOM.

// DatevPayrollLine is one Bewegungsdaten booking before serialization.
// Exactly one of HoursMinutes, Days and AmountCents is set.
type DatevPayrollLine struct {
	PersonnelNumber string
	WageType        string
	HoursMinutes    *int
	Days            *float64
	AmountCents     *int
}

// LODAS record types: 1 = hour bookings, 2 = day bookings. The field order of
// the data lines is fixed by this [Satzbeschreibung]; both tables are from the
// Schnittstellenhandbuch (u_lod_bwd_buchung_stunden / u_lod_bwd_buchung_tage).
const (
	lodasRecordHours = "1"
	lodasRecordDays  = "2"
	// lodasRecordAmount books an amount of the school's own wage types
	// (#4807) into the standard table with Bearbeitungsschlüssel 02
	// (Bruttowerte). Declared only when the file carries an amount, so a file
	// without one stays byte-identical.
	lodasRecordAmount   = "3"
	lodasAmountBSNumber = "02"
)

// WriteDatevLodas renders a LODAS file for the Abrechnungszeitraum
// year-month with the client of consultant and client.
func WriteDatevLodas(lines []DatevPayrollLine, consultant, client string, year, month int) []byte {
	period := fmt.Sprintf("01.%02d.%04d", month, year)
	var b strings.Builder
	b.WriteString("[Allgemein]\n")
	b.WriteString("Ziel=LODAS\n")
	b.WriteString("Version_SST=1.0\n")
	b.WriteString("BeraterNr=" + consultant + "\n")
	b.WriteString("MandantenNr=" + client + "\n")
	b.WriteString("Feldtrennzeichen=;\n")
	b.WriteString("Zahlenkomma=,\n")
	b.WriteString("Datumsformat=TT.MM.JJJJ\n")
	b.WriteString("\n[Satzbeschreibung]\n")
	b.WriteString(lodasRecordHours + ";u_lod_bwd_buchung_stunden;pnr#bwd;abrechnung_zeitraum#bwd;stunden#bwd;la_eigene#bwd;\n")
	b.WriteString(lodasRecordDays + ";u_lod_bwd_buchung_tage;pnr#bwd;abrechnung_zeitraum#bwd;tage#bwd;la_eigene#bwd;\n")
	if datevLinesCarryAmounts(lines) {
		b.WriteString(lodasRecordAmount + ";u_lod_bwd_buchung_standard;pnr#bwd;abrechnung_zeitraum#bwd;bs_wert_butab#bwd;bs_nr#bwd;la_eigene#bwd;\n")
	}
	b.WriteString("\n[Bewegungsdaten]\n")
	for _, line := range lines {
		if line.AmountCents != nil {
			b.WriteString(strings.Join([]string{lodasRecordAmount, line.PersonnelNumber, period, DatevCents(*line.AmountCents), lodasAmountBSNumber, line.WageType}, ";") + ";\n")
			continue
		}
		if line.Days != nil {
			b.WriteString(strings.Join([]string{lodasRecordDays, line.PersonnelNumber, period, DatevDays(*line.Days), line.WageType}, ";") + ";\n")
			continue
		}
		b.WriteString(strings.Join([]string{lodasRecordHours, line.PersonnelNumber, period, DatevHours(*line.HoursMinutes), line.WageType}, ";") + ";\n")
	}
	return EncodeDatevANSI(b.String())
}

func datevLinesCarryAmounts(lines []DatevPayrollLine) bool {
	for _, line := range lines {
		if line.AmountCents != nil {
			return true
		}
	}
	return false
}

// The 11-field Bewegungsdaten layout. Kalendertag stays empty: the bookings
// are month aggregates, the Abrechnungszeitraum is chosen at import time.
// Ausfallschlüssel, Wert, factors and cost centers stay empty — we book
// amounts per Lohnart, nothing else.
var datevLugHeader = []string{
	"Personalnummer", "Kalendertag", "Ausfallschluessel", "Lohnartennummer",
	"Stundenanzahl", "Tagesanzahl", "Wert",
	"Abw. Faktor", "Abw. Lohnveraenderung", "Kostenstellennummer", "Kostentraeger",
}

// WriteDatevLug renders a Lohn und Gehalt file.
func WriteDatevLug(lines []DatevPayrollLine) []byte {
	var b strings.Builder
	b.WriteString(strings.Join(datevLugHeader, ";") + "\n")
	for _, line := range lines {
		hours, days, value := "", "", ""
		switch {
		case line.AmountCents != nil:
			value = DatevCents(*line.AmountCents)
		case line.Days != nil:
			days = DatevDays(*line.Days)
		default:
			hours = DatevHours(*line.HoursMinutes)
		}
		fields := []string{line.PersonnelNumber, "", "", line.WageType, hours, days, value, "", "", "", ""}
		b.WriteString(strings.Join(fields, ";") + "\n")
	}
	return EncodeDatevANSI(b.String())
}

// DatevHours renders minutes as decimal hours with a German comma ("160,00").
func DatevHours(minutes int) string {
	return strings.Replace(strconv.FormatFloat(float64(minutes)/60.0, 'f', 2, 64), ".", ",", 1)
}

// DatevDays renders a day count with a German comma ("1,5").
func DatevDays(days float64) string {
	return strings.Replace(strconv.FormatFloat(days, 'f', -1, 64), ".", ",", 1)
}

// DatevCents renders cents as an amount with a German comma ("12,50").
func DatevCents(cents int) string {
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	return fmt.Sprintf("%s%d,%02d", sign, cents/100, cents%100)
}

// EncodeDatevANSI converts to Windows-1252 with CR/LF line ends — the
// encoding the LODAS Schnittstellenhandbuch prescribes ("ANSI-Code", CR/LF
// record ends) and the Lohn und Gehalt import default. Characters outside
// CP1252 are substitution-encoded rather than failing the whole file.
func EncodeDatevANSI(s string) []byte {
	s = strings.ReplaceAll(s, "\n", "\r\n")
	encoder := encoding.ReplaceUnsupported(charmap.Windows1252.NewEncoder())
	out, err := encoder.Bytes([]byte(s))
	if err != nil {
		// ReplaceUnsupported never errors; keep the fallback total anyway.
		return []byte(s)
	}
	return out
}

// SpreadsheetSafe keeps spreadsheet software from evaluating untrusted text
// as a formula. The apostrophe is Excel's explicit text marker. The school's
// exports and the Träger's time export (#4712) share it.
func SpreadsheetSafe(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	default:
		return value
	}
}
