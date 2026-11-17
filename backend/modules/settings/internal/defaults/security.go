package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

func init() {

	registerDefinitions(security_init_pin_0Definitions, security_init_mfa_1Definitions, security_init_lockout_2Definitions)

	// --- MFA / Two-Factor Authentication (issue #1308) ---

	// --- Account brute-force lockout policy (issue #586) ---

}

var security_init_pin_0Definitions = []config.Definition{
	{
		Key:         config.KeyOGSDevicePIN,
		Label:       "Geräte-PIN",
		Description: "Mit dieser PIN meldet sich Ihr Team am Tablet an. Ohne PIN geht die Anmeldung am Tablet nicht. Nehmen Sie keine leichte PIN wie 1234 oder 1111.",
		Type:        config.FieldPassword,
		// No default PIN (#7175): every school sets its own. Until it does,
		// device authentication rejects the empty PIN and admins see a notice.
		Default:         "",
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "devices",
		Category:        "pin",
		SortOrder:       1,
		Validation:      &config.ValidationRules{Pattern: &pinPattern},
		AccessPolicy:    config.AccessAdminOnly,
		DependsOn:       config.DependsOnEq(config.KeyModuleNFCAnwesenheit, true),
	},
}

var security_init_mfa_1Definitions = []config.Definition{
	{
		Key:             config.KeyMFAMode,
		Label:           "Zwei-Faktor-Anmeldung (Code per E-Mail)",
		Description:     "Für Verwaltung ist ein zweiter Anmeldenachweis immer Pflicht. Ebenso für Personalstammdaten, Personaldokumente, Personalfinanzen und Gesundheitsdokumente. Auch zum Lesen von Einkommensnachweisen der Eltern. Auch beim Verwalten fremder Arbeitszeiten und Genehmigen von Urlaub. Gesundheitshinweise der Kinder allein lösen diese Pflicht nicht aus. „Aus“ und „Nur Admins“ ändern daran nichts. „Alle Mitarbeitenden“ schützt zusätzlich das ganze Team.",
		Type:            config.FieldSelect,
		Default:         config.MFAModeOff,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "security",
		Category:        "mfa",
		SortOrder:       10,
		Options: &config.SelectOptions{
			Static: []config.SelectOption{
				{Label: "Aus", Value: config.MFAModeOff},
				{Label: "Nur Admins", Value: config.MFAModeRequiredAdmins},
				{Label: "Alle Mitarbeitenden", Value: config.MFAModeRequiredAll},
			},
		},
	},
	{
		Key:             config.KeyMFATrustedDeviceEnabled,
		Label:           "Gerät merken erlauben",
		Description:     "Mitarbeitende können beim Anmelden ihr Gerät merken lassen. Dort brauchen sie dann eine Zeit lang keinen Code.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "security",
		Category:        "mfa",
		SortOrder:       20,
	},
	{
		Key:             config.KeyMFATrustedDeviceDays,
		Label:           "Gültigkeit gemerkter Geräte (Tage)",
		Description:     "So lange braucht ein gemerktes Gerät keinen Code.",
		Type:            config.FieldNumber,
		Default:         90,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "security",
		Category:        "mfa",
		SortOrder:       21,
		Validation:      config.Range(1, 180),
		DependsOn:       config.DependsOnEq(config.KeyMFATrustedDeviceEnabled, true),
	},
}

var security_init_lockout_2Definitions = []config.Definition{
	{
		Key:             config.KeyAccountLockoutThreshold,
		Label:           "Fehlversuche bis zur Code-Sperre",
		Description:     "Nach so vielen falschen Bestätigungscodes pausiert die Code-Prüfung.",
		Type:            config.FieldNumber,
		Default:         5,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "security",
		Category:        "lockout",
		SortOrder:       30,
		Validation:      config.Range(1, 20),
	},
	{
		Key:             config.KeyAccountLockoutDurationMinutes,
		Label:           "Dauer der Code-Sperre (Minuten)",
		Description:     "So lange pausiert danach die Code-Prüfung. Für falsche Passwörter gilt diese Einstellung nicht.",
		Type:            config.FieldNumber,
		Default:         15,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "security",
		Category:        "lockout",
		SortOrder:       31,
		Validation:      config.Range(1, 1440),
	},
}

var pinPattern = `^\d{4}$`
