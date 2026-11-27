package care

import (
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/careplan/absencerecords"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SickNoteEventBody renders the chat pill for a parent absence submission. The
// label MUST follow the submitted status: a "Krankmeldung" (sick) and an
// "Entschuldigte Abwesenheit" (excused — e.g. an appointment, #1735) are
// distinct in the data and to staff, so an excused absence must not be
// recorded as a sickness.
func SickNoteEventBody(status string, dates []calendar.Date) string {
	parts := make([]string, 0, len(dates))
	for _, d := range dates {
		parts = append(parts, d.Format("02.01."))
	}
	label := "Krankmeldung"
	if status == absencerecords.StudentStatusDayExcused {
		label = "Entschuldigte Abwesenheit"
	}
	return label + ": " + strings.Join(parts, ", ")
}
