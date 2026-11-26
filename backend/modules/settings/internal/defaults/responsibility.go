package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// Who is responsible at a school for contracts, billing and staff (#4811).
// Without a value the Träger is, for all three.
func init() {
	registerDefinitions(responsibilityDefinitions)
}

// responsibleBodyOptions are the bodies every responsibility offers.
func responsibleBodyOptions() *config.SelectOptions {
	return &config.SelectOptions{Static: []config.SelectOption{
		{Label: "Träger", Value: config.ResponsibleBodyTraeger},
		{Label: "Schulträger", Value: config.ResponsibleBodySchultraeger},
		{Label: "Gemeinde", Value: config.ResponsibleBodyGemeinde},
	}}
}

// responsibilityFallback says, once at the first responsibility, that a
// body without stored master data cannot stand on a document.
const responsibilityFallback = " Name und Anschrift von Schulträger und Gemeinde trägt das Träger-Büro ein. Solange sie fehlen, bleibt der Träger zuständig."

var responsibilityDefinitions = []config.Definition{
	{
		Key:             config.KeyResponsibilityContracts,
		Levels:          config.LevelBoth,
		Label:           "Wer schließt die Betreuungsverträge?",
		Description:     "Diese Stelle steht in neuen Betreuungsverträgen als Absender und, wenn die Vertragsbedingungen keinen Vertragspartner nennen, als Vertragspartner. Schon verschickte Verträge bleiben, wie sie sind." + responsibilityFallback,
		Type:            config.FieldSelect,
		Default:         config.ResponsibleBodyTraeger,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "zustaendigkeiten",
		Category:        "zustaendige-stellen",
		SortOrder:       10,
		Options:         responsibleBodyOptions(),
	},
	{
		Key:             config.KeyResponsibilityBilling,
		Levels:          config.LevelBoth,
		Label:           "Wer rechnet mit den Eltern ab?",
		Description:     "Diese Stelle stellt neue Rechnungen und Bescheide aus und zieht Lastschriften mit ihrer eigenen Gläubiger-ID ein. Dafür braucht sie zusätzlich Gläubiger-ID und Konto. Solange etwas fehlt, rechnet der Träger ab. Schon ausgestellte Schreiben bleiben, wie sie sind.",
		Type:            config.FieldSelect,
		Default:         config.ResponsibleBodyTraeger,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "zustaendigkeiten",
		Category:        "zustaendige-stellen",
		SortOrder:       20,
		Options:         responsibleBodyOptions(),
	},
	{
		Key:             config.KeyResponsibilityStaff,
		Levels:          config.LevelBoth,
		Label:           "Wer stellt das Personal an?",
		Description:     "Diese Stelle steht in der Personalakte beim Einsatzort als Arbeitgeber. Im Lohnexport des Trägers stehen ihre Stunden mit ihrer Kostenstelle oder in einer eigenen Datei.",
		Type:            config.FieldSelect,
		Default:         config.ResponsibleBodyTraeger,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "zustaendigkeiten",
		Category:        "zustaendige-stellen",
		SortOrder:       30,
		Options:         responsibleBodyOptions(),
	},
}
