package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// The Träger values of the Einsatzplanung (#4708, ADR 0089 section 8): the
// switch „Einsatzplanung in moto“ and the working-time rules every planner
// is checked against, at every school of the Träger. The defaults are the
// limits of the ArbZG. Whether a shortened rest applies to an OGS is for
// the Träger and its lawyer to decide; moto only warns.
func init() {
	registerDefinitions(staffPlanningDefinitions)
}

var staffPlanningDefinitions = []config.Definition{
	{
		Key:               config.KeyStaffPlanningEnabled,
		Levels:            config.LevelTraeger,
		TraegerWriteRight: config.TraegerRightStaff,
		Label:             "Einsatzplanung in moto",
		Description:       "Aus: Niemand legt in moto neue Schichten an, weder der Träger noch die Schulen. Das passt, wenn dein Träger Einsätze in einem eigenen System plant. Geplante Schichten bleiben sichtbar.",
		Type:              config.FieldBoolean,
		Default:           true,
		ReadPermission:    "config:read",
		WritePermission:   "config:manage",
		Tab:               "einsatzplanung",
		Category:          "planung-in-moto",
		SortOrder:         10,
	},
	{
		Key:               config.KeyStaffPlanningMaxDailyHours,
		Levels:            config.LevelTraeger,
		TraegerWriteRight: config.TraegerRightStaff,
		Label:             "Höchstens so viele Stunden Arbeit am Tag",
		Description:       "Plant jemand an einem Tag mehr, an allen Schulen zusammen und ohne Pausen, warnt moto. In der Regel erlaubt das Arbeitszeitgesetz bis zu 10 Stunden. 0 schaltet die Warnung aus.",
		Type:              config.FieldNumber,
		Default:           10,
		ReadPermission:    "config:read",
		WritePermission:   "config:manage",
		Tab:               "einsatzplanung",
		Category:          "arbeitszeitregeln",
		SortOrder:         20,
		Validation:        config.Range(0, 12),
	},
	{
		Key:               config.KeyStaffPlanningMinRestHours,
		Levels:            config.LevelTraeger,
		TraegerWriteRight: config.TraegerRightStaff,
		Label:             "Ruhezeit zwischen zwei Arbeitstagen",
		Description:       "Ist die Zeit zwischen zwei Arbeitstagen kürzer, warnt moto. Bei 10 Stunden verlangt das Gesetz einen Ausgleich. Daran erinnert moto. Ob 10 Stunden für deine Einrichtungen erlaubt sind, kläre bitte rechtlich.",
		Type:              config.FieldSelect,
		Default:           "11",
		ReadPermission:    "config:read",
		WritePermission:   "config:manage",
		Tab:               "einsatzplanung",
		Category:          "arbeitszeitregeln",
		SortOrder:         30,
		Options: &config.SelectOptions{
			Static: []config.SelectOption{
				{Label: "11 Stunden", Value: "11"},
				{Label: "10 Stunden, mit Ausgleich", Value: "10"},
			},
		},
	},
	{
		Key:               config.KeyStaffPlanningCheckBreaks,
		Levels:            config.LevelTraeger,
		TraegerWriteRight: config.TraegerRightStaff,
		Label:             "Pausen prüfen",
		Description:       "Wer mehr als 6 Stunden arbeitet, braucht 30 Minuten Pause, ab 9 Stunden 45 Minuten. Fehlt Pause, warnt moto. Eine Lücke von mindestens 15 Minuten zwischen zwei Schichten zählt als Pause.",
		Type:              config.FieldBoolean,
		Default:           true,
		ReadPermission:    "config:read",
		WritePermission:   "config:manage",
		Tab:               "einsatzplanung",
		Category:          "arbeitszeitregeln",
		SortOrder:         40,
	},
}
