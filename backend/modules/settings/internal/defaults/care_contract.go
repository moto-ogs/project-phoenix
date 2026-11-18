package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// How the contracts of a school come about (#4680, ADR 0088 section 6). The
// Träger sets the way for all its schools, a school may take the other one.
// The values are the constants of the Betreuungsvertrag
// (carecontract.ModeSendLater, carecontract.ModeOnAcceptance).
func init() {
	registerDefinitions(careContractDefinitions)
	registerDefinitions(careContractNoticeDefinitions)
}

// noticeConfirmationPattern admits the placeholders the Betreuungsvertrag
// fills in (carecontract application, notice_text.go) and nothing else in
// curly braces.
var noticeConfirmationPattern = `^(?:[^{}]|\{(?:Kind|Module|Schule|Vertragsende|Eingang|Grund|Träger)\})+$`

// noticeConfirmationMaxLength keeps the confirmation a short letter; the
// table refuses more than 8000 characters.
var noticeConfirmationMaxLength = 4000

// The confirmations of a termination and a withdrawal (#4682). The parents
// get them by mail and see them in the parents portal; the text is kept
// with the declaration as sent.
var careContractNoticeDefinitions = []config.Definition{
	{
		Key:             config.KeyCareContractTerminationConfirmation,
		Levels:          config.LevelTraeger,
		Label:           "Bestätigung einer Kündigung",
		Description:     "Diesen Text bekommen Eltern per E-Mail, wenn sie einen Betreuungsvertrag kündigen. Er steht auch in der Eltern-App. Erlaubte Platzhalter: {Kind}, {Module}, {Schule}, {Vertragsende}, {Eingang}, {Träger}.",
		Type:            config.FieldTextarea,
		Default:         "wir bestätigen deine Kündigung des Betreuungsvertrags für {Kind} ({Module}, {Schule}).\n\nDeine Kündigung ist am {Eingang} bei uns eingegangen. Der Vertrag endet mit Ablauf des {Vertragsende}. Bis dahin findet die Betreuung wie gebucht statt.\n\nMit freundlichen Grüßen\n{Träger}",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "vertraege",
		Category:        "vertrag-bestaetigungen",
		SortOrder:       10,
		Validation:      &config.ValidationRules{Required: true, Pattern: &noticeConfirmationPattern, MaxLength: &noticeConfirmationMaxLength},
	}, {
		Key:             config.KeyCareContractWithdrawalConfirmation,
		Levels:          config.LevelTraeger,
		Label:           "Bestätigung eines Widerrufs",
		Description:     "Diesen Text bekommen Eltern per E-Mail, wenn sie einen Betreuungsvertrag widerrufen. Er steht auch in der Eltern-App. Erlaubte Platzhalter: {Kind}, {Module}, {Schule}, {Eingang}, {Träger}.",
		Type:            config.FieldTextarea,
		Default:         "wir bestätigen deinen Widerruf des Betreuungsvertrags für {Kind} ({Module}, {Schule}).\n\nDein Widerruf ist am {Eingang} bei uns eingegangen. Der Vertrag ist damit aufgehoben. Hast du schon etwas bezahlt, erstatten wir es dir innerhalb von 14 Tagen.\n\nMit freundlichen Grüßen\n{Träger}",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "vertraege",
		Category:        "vertrag-bestaetigungen",
		SortOrder:       20,
		Validation:      &config.ValidationRules{Required: true, Pattern: &noticeConfirmationPattern, MaxLength: &noticeConfirmationMaxLength},
	}, {
		Key:             config.KeyCareContractExtraordinaryConfirmation,
		Levels:          config.LevelTraeger,
		Label:           "Bestätigung einer außerordentlichen Kündigung",
		Description:     "Diesen Text bekommen Eltern per E-Mail, wenn sie einen Betreuungsvertrag außerordentlich kündigen. Das Vertragsende legst du erst nach der Prüfung fest. Erlaubte Platzhalter: {Kind}, {Module}, {Schule}, {Eingang}, {Grund}, {Träger}.",
		Type:            config.FieldTextarea,
		Default:         "wir bestätigen den Eingang deiner außerordentlichen Kündigung des Betreuungsvertrags für {Kind} ({Module}, {Schule}).\n\nDeine Kündigung ist am {Eingang} bei uns eingegangen. Dein Grund: {Grund}\n\nWir prüfen deinen Grund. Danach legen wir fest, wann der Vertrag endet. Das Datum teilen wir dir per E-Mail mit. Du siehst es auch in der Eltern-App. Bis dahin findet die Betreuung wie gebucht statt.\n\nMit freundlichen Grüßen\n{Träger}",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "vertraege",
		Category:        "vertrag-bestaetigungen",
		SortOrder:       15,
		Validation:      &config.ValidationRules{Required: true, Pattern: &noticeConfirmationPattern, MaxLength: &noticeConfirmationMaxLength},
	}, {
		Key:             config.KeyCareContractEndSetNotice,
		Levels:          config.LevelTraeger,
		Label:           "Mitteilung: Vertragsende festgelegt",
		Description:     "Diesen Text bekommen Eltern per E-Mail und in der Eltern-App, wenn du nach einer außerordentlichen Kündigung das Vertragsende festlegst. Erlaubte Platzhalter: {Kind}, {Module}, {Schule}, {Vertragsende}, {Eingang}, {Grund}, {Träger}.",
		Type:            config.FieldTextarea,
		Default:         "wir haben deine außerordentliche Kündigung des Betreuungsvertrags für {Kind} ({Module}, {Schule}) geprüft.\n\nDer Vertrag endet mit Ablauf des {Vertragsende}. Das ist der letzte Betreuungstag. Bis dahin findet die Betreuung wie gebucht statt.\n\nMit freundlichen Grüßen\n{Träger}",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "vertraege",
		Category:        "vertrag-bestaetigungen",
		SortOrder:       16,
		Validation:      &config.ValidationRules{Required: true, Pattern: &noticeConfirmationPattern, MaxLength: &noticeConfirmationMaxLength},
	}, {
		Key:             config.KeyCareContractReasonRejectedNotice,
		Levels:          config.LevelTraeger,
		Label:           "Mitteilung: Grund nicht anerkannt",
		Description:     "Diesen Text bekommen Eltern per E-Mail und in der Eltern-App, wenn du den Grund einer außerordentlichen Kündigung nicht anerkennst. Die Kündigung gilt dann als ordentliche Kündigung zum nächsten möglichen Termin. Erlaubte Platzhalter: {Kind}, {Module}, {Schule}, {Vertragsende}, {Eingang}, {Grund}, {Träger}.",
		Type:            config.FieldTextarea,
		Default:         "wir haben deine außerordentliche Kündigung des Betreuungsvertrags für {Kind} ({Module}, {Schule}) geprüft. Deine Kündigung ist am {Eingang} bei uns eingegangen.\n\nDeinen Grund erkennen wir nicht an. Deine Kündigung gilt deshalb als ordentliche Kündigung zum nächsten möglichen Termin. Der Vertrag endet mit Ablauf des {Vertragsende}. Das ist der letzte Betreuungstag. Bis dahin findet die Betreuung wie gebucht statt.\n\nMit freundlichen Grüßen\n{Träger}",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "vertraege",
		Category:        "vertrag-bestaetigungen",
		SortOrder:       17,
		Validation:      &config.ValidationRules{Required: true, Pattern: &noticeConfirmationPattern, MaxLength: &noticeConfirmationMaxLength},
	},
}

var careContractDefinitions = []config.Definition{
	{
		Key:             config.KeyCareContractConclusionMode,
		Levels:          config.LevelBoth,
		Label:           "Wann gilt der Betreuungsvertrag?",
		Description:     "Bei der Annahme: Nimmt die Schule eine Anmeldung an, gilt der Vertrag sofort. Die Eltern bekommen ihn per E-Mail und in der Eltern-App und müssen nichts unterschreiben. Voraussetzung: Die Eltern stimmen im Anmeldeformular den Vertragsbedingungen zu (AGB / Teilnahmebedingungen). Später verschicken: Das Träger-Büro erstellt den Vertrag und schickt ihn den Eltern.",
		Type:            config.FieldSelect,
		Default:         "nachtraeglich",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "enrollment",
		Category:        "vertragsabschluss",
		SortOrder:       90,
		Options: &config.SelectOptions{
			Static: []config.SelectOption{
				{Label: "Später verschicken", Value: "nachtraeglich"},
				{Label: "Bei der Annahme", Value: "bei_annahme"},
			},
		},
	},
}
