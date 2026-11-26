package defaults

import config "github.com/moto-ogs/project-phoenix/modules/settings/records"

var studentPhotosDefinitions = []config.Definition{
	{
		Key:             config.KeyStudentPhotosEnabled,
		Label:           "Kinderfotos",
		Description:     "Wer Kinder bearbeiten darf, kann in der Datenverwaltung Fotos hinterlegen. Nur mit nachweisbarer Einwilligung der Eltern. Die Fotos erscheinen in Suche, Räumen, Abholplan und beim Kind.",
		Type:            config.FieldBoolean,
		Default:         false,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		// Category key is shown verbatim as the section header in the
		// settings UI (schema_builder.Label = catName). German umlaut here
		// matches the visible "Kinder" copy throughout the photo feature.
		Category:  "kinder",
		SortOrder: 50,
	},
	{
		Key:   config.KeyStudentCardActivitiesEnabled,
		Label: "Angebote auf der Kinderkarte",
		// #6487: staff see at once which offerings a child has today between
		// its arrival and pickup, on every child card since #8194. Off until
		// a school switches it on: switched on, each list pays three set
		// reads, and the query budgets of "Gruppen" and "Aktuelle Aufsicht"
		// leave no room for a read every school pays.
		Description:     "Zeigt auf den Kinderkarten die Angebote, die ein Kind heute hat. Zum Beispiel: 14:00–15:00 Töpfer-AG. Das gilt für „Gruppen“, „Alle Kinder“ und „Aktuelle Aufsicht“.",
		Type:            config.FieldBoolean,
		Default:         false,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "kinder",
		SortOrder:       40,
	},
}
