package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The term for the school's care in fixed parent texts (#6042). Schools in
// Lower Saxony call it "GTS" (Ganztagsschule), others keep "OGS". The texts
// decline the term with its article ("die OGS prüft", "der Hort prüft").
// The presets are feminine; a school with its own name chooses the article
// (#8136), and textnorm.CareArticle keeps "die" for everyone else.
func init() {
	registerDefinitions(careFacilityTermDefinitions)
}

// careFacilityTermPattern admits a plain name: letters, digits, spaces and
// the punctuation of school names. Markup, placeholders, line breaks and
// leading or trailing spaces never pass.
var careFacilityTermPattern = `^[\p{L}\p{N}(](?:[\p{L}\p{N} ./()-]*[\p{L}\p{N}.)])?$`

var careFacilityTermMaxLength = 40

var careFacilityTermDefinitions = []config.Definition{
	{
		Key:         config.KeyEnrollmentCareFacilityTerm,
		Label:       "Name der Betreuung in Texten für Eltern",
		Description: "So heißt deine Betreuung in den festen Texten der Online-Anmeldung, der Eltern-App und in den E-Mails dazu. Auch Fehlermeldungen für Eltern und für dein Team nennen ihn. Zum Beispiel: „Die OGS prüft deine Angaben.“ Wenn keine Auswahl passt, wähle „Eigener Name“. Wähle dann auch den Artikel, der zu deinem Namen passt, zum Beispiel „der Hort“. Die festen Texte setzen ihn vor den Namen. Deine eigenen Texte im Formular ändern sich nicht.",
		Type:        config.FieldText,
		Default:     "OGS",
		Options: &config.SelectOptions{Static: []config.SelectOption{
			{Label: "OGS", Value: "OGS"},
			{Label: "GTS", Value: "GTS"},
		}},
		Validation: &config.ValidationRules{
			Pattern:   &careFacilityTermPattern,
			MaxLength: &careFacilityTermMaxLength,
		},
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "enrollment",
		Category:        "allgemein",
		SortOrder:       2,
	},
	{
		Key:         config.KeyEnrollmentCareFacilityArticle,
		Label:       "Artikel zum eigenen Namen der Betreuung",
		Description: "Gilt nur für einen eigenen Namen. Die festen Texte schreiben den Artikel vor den Namen. Zum Beispiel: „Der Hort prüft deine Angaben.“ OGS und GTS stehen immer mit „die“.",
		Type:        config.FieldSelect,
		Default:     textnorm.CareArticleDie,
		Options: &config.SelectOptions{Static: []config.SelectOption{
			{Label: "der", Value: textnorm.CareArticleDer},
			{Label: "die", Value: textnorm.CareArticleDie},
			{Label: "das", Value: textnorm.CareArticleDas},
		}},
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "enrollment",
		Category:        "allgemein",
		SortOrder:       3,
	},
}
