package api

import "fmt"

// seedPersonalLetterTitle names the Elternbrief that names each child
// (#4813); it is published before the Laternenfest letter, so that one stays
// the newest entry of the feed.
const seedPersonalLetterTitle = "Elternbrief: Ihre Betreuungszeiten im Halbjahr"

// seedPersonalLetterBody uses every placeholder of a letter, so each family
// reads its own child's class, group, booked days and pickup time, and the
// printed letters show the same.
const seedPersonalLetterBody = "Liebe Eltern von {{vorname}},\n\n" +
	"für das zweite Halbjahr haben wir die Betreuung so geplant. {{vorname}} geht in die {{klasse}}.\n\n" +
	"Gruppe in der OGS: {{gruppe}}\nGebuchte Tage: {{betreuungstage}}\nAbholzeit: {{abholzeit}}\n\n" +
	"Bitte prüfen Sie die Angaben und bestätigen Sie den Brief. Stimmt etwas nicht, sagen Sie uns bis Freitag Bescheid.\n\n" +
	"Viele Grüße\nIhr OGS-Team"

// seedPersonalLetter publishes the Elternbrief with the values of each child
// to the whole school, so the letter status, the parents portal and the
// printed letters have one letter per child on every dev machine.
func seedPersonalLetter(rt *Runtime, reader *AuthRef) error {
	raw, err := rt.Client.PostWithAuth(rt.TenantAuth, "/api/parent-announcements/", map[string]any{
		"title":          seedPersonalLetterTitle,
		"body":           seedPersonalLetterBody,
		"priority":       "info",
		"delivery_mode":  "letter",
		"email_audience": "portal_only",
		"targets":        []map[string]any{{"target_type": "school_all"}},
	})
	if err != nil {
		return fmt.Errorf("create personal parent letter: %w", err)
	}
	id, err := parseEnvelopeStringID(raw)
	if err != nil {
		return fmt.Errorf("parse personal parent letter: %w", err)
	}
	if err := publishAndRead(rt, id, reader); err != nil {
		return fmt.Errorf("personal parent letter: %w", err)
	}
	return nil
}
