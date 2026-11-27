package email_test

import (
	"bytes"
	"html/template"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHolidayRegistrationAcceptedTemplate_Renders pins the acceptance mail of
// a holiday registration (#6672): the children with their weeks and time
// models, the Träger's text as plain text with its lines, and the button to
// the parents portal only with a link.
func TestHolidayRegistrationAcceptedTemplate_Renders(t *testing.T) {
	t.Parallel()
	tpl, err := template.ParseGlob(filepath.Join(".", "*.html"))
	require.NoError(t, err, "parse all email templates")
	content := map[string]any{
		"GuardianName": "Eva Muster",
		"SchoolName":   "Gemeinde Bissendorf",
		"PeriodName":   "Weihnachtsferien 2026/27",
		"Binding":      true,
		"Children": []map[string]any{
			{"Name": "Lia Muster", "Weeks": []string{"04.01.2027 bis 08.01.2027: OGS Nord, bis 16 Uhr (08:00 bis 16:00 Uhr)"}},
			{"Name": "Ben Muster", "Guest": true, "Weeks": []string{"04.01.2027 bis 08.01.2027: OGS Nord, bis 13 Uhr (08:00 bis 13:00 Uhr)"},
				"WaitlistWeeks": []string{"11.01.2027 bis 15.01.2027: OGS Süd, bis 13 Uhr (08:00 bis 13:00 Uhr)"}},
		},
		"Waitlisted":   true,
		"TraegerText":  "Bitte Mittagessen mitgeben.\n<script>alert(1)</script>",
		"ParentAppURL": "https://eltern.example.org/",
	}

	var out bytes.Buffer
	require.NoError(t, tpl.ExecuteTemplate(&out, "holiday-registration-accepted.html", content))
	body := out.String()
	for _, want := range []string{"Ihre Ferienanmeldung ist bestätigt", "Eva Muster",
		"der Träger <strong>Gemeinde Bissendorf</strong> hat Ihre Anmeldung für die Ferienbetreuung „<strong>Weihnachtsferien 2026/27</strong>“ bestätigt.",
		"Wird ein Platz frei, bekommt Ihr Kind ihn automatisch. Wir schreiben Ihnen dann eine E-Mail.",
		"Bitte antworten Sie nicht auf diese E-Mail. Bei Fragen wenden Sie sich an den Träger (Gemeinde Bissendorf).",
		"Lia Muster", "bis 16 Uhr (08:00 bis 16:00 Uhr)", "(Feriengast)", "Auf der Warteliste:", "Hinweise vom Träger",
		"Bitte Mittagessen mitgeben.", "Die Anmeldung ist verbindlich.", "In der Eltern-App ansehen"} {
		assert.Contains(t, body, want)
	}
	assertNoDuForm(t, body)
	assert.Contains(t, body, `href="https://eltern.example.org/"`)
	assert.Contains(t, body, "white-space: pre-line;", "the text keeps the lines the Träger wrote")
	assert.NotContains(t, body, "<script>", "the text of the Träger is text, not HTML")

	out.Reset()
	content["TraegerText"], content["ParentAppURL"] = "", ""
	require.NoError(t, tpl.ExecuteTemplate(&out, "holiday-registration-accepted.html", content))
	assert.NotContains(t, out.String(), "Hinweise vom Träger", "without a text the mail has its fixed part only")
	assert.NotContains(t, out.String(), "In der Eltern-App ansehen", "without an account there is no button")
}

// TestHolidayRegistrationAcceptedTemplate_OffersAParentAccount pins ADR 0216
// point 11: without a parent account the acceptance mail has one button to
// set one up and how long its link holds, never both buttons.
func TestHolidayRegistrationAcceptedTemplate_OffersAParentAccount(t *testing.T) {
	t.Parallel()
	tpl, err := template.ParseGlob(filepath.Join(".", "*.html"))
	require.NoError(t, err, "parse all email templates")
	content := map[string]any{
		"GuardianName": "Jana Gastfamilie", "SchoolName": "Gemeinde Bissendorf", "PeriodName": "Herbstferien",
		"Children": []map[string]any{{"Name": "Ole Gastfamilie", "Weeks": []string{"12.10.2026 bis 16.10.2026"}}},
		"SetupURL": "https://eltern.example.org/ferienkonto/setup-token",
	}

	var out bytes.Buffer
	require.NoError(t, tpl.ExecuteTemplate(&out, "holiday-registration-accepted.html", content))
	body := out.String()
	for _, want := range []string{"Elternkonto einrichten", "Der Link gilt 30 Tage.", "Mit einem Elternkonto sehen Sie den Stand Ihrer Anmeldung in der Eltern-App. Dort finden Sie auch Ihre Dokumente."} {
		assert.Contains(t, body, template.HTMLEscapeString(want))
	}
	assertNoDuForm(t, body)
	assert.Contains(t, body, `href="https://eltern.example.org/ferienkonto/setup-token"`)
	assert.NotContains(t, body, "In der Eltern-App ansehen")
	assert.Equal(t, 1, strings.Count(body, `class="button"`), "one button")
	assert.NotContains(t, body, "—", "no em dash")
}

// duForm is the informal address in the visible text of a mail.
var duForm = regexp.MustCompile(`(?i)\b(du|dein\p{L}*|dir|dich|antworte|wende)\b`)

// assertNoDuForm pins the decision of 27.11.2026 (Nachtrag of ADR 0294): the
// acceptance mail addresses the parents with „Sie“, no du-form remains in
// its fixed part. The test texts of the Träger hold none either.
func assertNoDuForm(t *testing.T, body string) {
	t.Helper()
	text := regexp.MustCompile(`(?s)<style.*?</style>|<[^>]*>`).ReplaceAllString(body, " ")
	assert.Empty(t, duForm.FindAllString(text, -1), "the acceptance mail uses the Sie-form")
}
