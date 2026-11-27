package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// Notification settings (#1419 4d). Email notifications around the staff
// absence approval workflow. Brand-new setting with no legacy env var, so
// consumers resolve it directly without an env fallback.
func init() {
	registerDefinitions(notifications_init_zeiterfassung_0Definitions, notifications_init_benachrichtigungen_1Definitions)

	// Feature flag for the notification abstraction (#1624). On by default
	// since the personal-notification epic: every producer behind it now
	// requires the recipient's own consent, and consent starts empty, so an
	// enabled school still delivers nothing until someone asks for something.
	// Off would only mean that a person's own choice in their profile is
	// silently ignored.

	// Delivery window. Checked once in the notification router, so it bounds
	// every producer rather than each one carrying its own quiet hours.

	// Health information about a child fanning out to a group's phones is a
	// data-minimisation decision for the school, not a matter of personal
	// taste, so it exists on top of the per-person opt-in.

}

var notifications_init_zeiterfassung_0Definitions = []config.Definition{
	{
		Key:             config.KeyNotificationsAbsenceApprovalEmail,
		Label:           "E-Mails zu Abwesenheitsanträgen",
		Description:     "Sendet E-Mails, wenn Mitarbeitende einen Abwesenheitsantrag stellen und wenn die Leitung genehmigt, ablehnt oder eine Rückfrage stellt.",
		Type:            config.FieldBoolean,
		Default:         false,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "zeiterfassung",
		SortOrder:       8,
	},
	{
		Key:             config.KeyNotificationsClassTimetableChangedEnabled,
		Label:           "Hinweis bei geändertem Stundenplan einer Klasse",
		Description:     "Ändert sich der Unterrichtsschluss einer Klasse, bekommen die Lehrkräfte der Klasse, die Betreuung ihrer Kinder und die Eltern einen Hinweis in moto. Ob dazu eine Mitteilung aufs Handy kommt, entscheidet jede Person selbst.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       9,
	},
}

var notifications_init_benachrichtigungen_1Definitions = []config.Definition{
	{
		Key:             config.KeyNotificationsDispatchEnabled,
		Label:           "Benachrichtigungen senden",
		Description:     "Hinweise in moto und auf dem Handy. Was ankommt, wählt jede Person im eigenen Profil.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       1,
	},
	{
		Key:             config.KeyNotificationsActiveWindowStart,
		Label:           "Benachrichtigungen ab",
		Description:     "Ab dieser Uhrzeit werden Benachrichtigungen zugestellt.",
		Type:            config.FieldTime,
		Default:         "06:00",
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       2,
		DependsOn:       config.DependsOnEq(config.KeyNotificationsDispatchEnabled, true),
	},
	{
		Key:             config.KeyNotificationsActiveWindowEnd,
		Label:           "Benachrichtigungen bis",
		Description:     "Bis zu dieser Uhrzeit werden Benachrichtigungen zugestellt. Danach bleibt es still bis zum nächsten Morgen.",
		Type:            config.FieldTime,
		Default:         "18:00",
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       3,
		DependsOn:       config.DependsOnEq(config.KeyNotificationsDispatchEnabled, true),
	},
	{
		Key:             config.KeyNotificationsOnDutyOnly,
		Label:           "Nur im Dienst benachrichtigen",
		Description:     "Persönliche Hinweise erreichen nur Personen, die gerade eingestempelt sind. Nutze das nur, wenn dein Team die Zeiterfassung verwendet.",
		Type:            config.FieldBoolean,
		Default:         false,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       4,
		DependsOn:       config.DependsOnEq(config.KeyNotificationsDispatchEnabled, true),
	},
	{
		Key:             config.KeyNotificationsAbsenceReportedEnabled,
		Label:           "Hinweis bei Krankmeldung",
		Description:     "OGS-Admins können einen Hinweis bekommen. Bei festen Gruppen auch die Betreuung der Gruppe. In moto schule auch die Lehrkräfte der Klasse und die Schulverwaltung. Jede Person entscheidet selbst.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       5,
	},
	{
		Key:             config.KeyNotificationsInstanceCancelledEnabled,
		Label:           "Hinweis bei Absage eines Termins",
		Description:     "Wird ein Termin oder Angebot abgesagt, bekommt das eingeplante Personal einen Hinweis in moto. Ob dazu eine Mitteilung aufs Handy kommt, entscheidet jede Person selbst.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       6,
	},
	{
		Key:             config.KeyNotificationsStaffingChangedEnabled,
		Label:           "Hinweis bei Vertretung und Dienstplanänderung",
		Description:     "Vertritt jemand oder ist jemand nicht da, bekommen die vertretende und die vertretene Person einen Hinweis in moto. Auch die Lehrkräfte der Gruppe und wer die Gruppe übergeben bekommen hat, sehen ihn. Ob dazu eine Mitteilung aufs Handy kommt, entscheidet jede Person selbst.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       7,
	},
	{
		Key:             config.KeyNotificationsStaffNoticePublishedEnabled,
		Label:           "Benachrichtigung bei neuem Hinweis der Leitung",
		Description:     "Legt die Leitung einen Hinweis für die Betreuung an, steht er bei den Benachrichtigungen. Eine Mitteilung aufs Handy bekommt nur, wer sie selbst einschaltet.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       8,
	},
	{
		Key:             config.KeyNotificationsInstanceRoomChangedEnabled,
		Label:           "Hinweis bei Raumänderung",
		Description:     "Findet ein Termin oder Angebot in einem anderen Raum statt, bekommen das eingeplante Personal und die Eltern der Kinder einen Hinweis in moto. Ob dazu eine Mitteilung aufs Handy kommt, entscheidet jede Person selbst.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       9,
	},
	{
		Key:             config.KeyNotificationsSchoolClosingDayEnabled,
		Label:           "Benachrichtigung bei Schließtagen",
		Description:     "Wird ein Schließtag eingetragen, geändert oder gelöscht, steht das bei den Benachrichtigungen aller Mitarbeitenden, Lehrkräfte, Eltern, im Träger-Büro und beim Caterer. Liegt der Tag in den nächsten 14 Tagen, bekommen Mitarbeitende, Lehrkräfte und Eltern auch eine Mitteilung aufs Handy. Jede Person kann sie selbst ausschalten.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       10,
	},
	{
		Key:             config.KeyNotificationsMealPlanChangedEnabled,
		Label:           "Hinweis bei geändertem Speiseplan",
		Description:     "Ändert sich der Speiseplan für einen Tag, bekommen die Eltern einen Hinweis im Elternportal, wenn ihr Kind an dem Tag ein Essen gebucht hat. Dein Caterer sieht den Hinweis auch. Eine Mitteilung aufs Handy bekommt nur, wer sie selbst einschaltet.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       11,
	},
	{
		Key:             config.KeyNotificationsOpeningChangeEnabled,
		Label:           "Benachrichtigung bei geänderter Öffnungszeit",
		Description:     "Ändert sich die Öffnungszeit an einem Tag, bekommen Team, Eltern und Träger-Büro einen Hinweis in moto. Liegt der Tag in den nächsten 14 Tagen, kommt für Team und Eltern auch eine Mitteilung aufs Handy. Jede Person kann sie selbst ausschalten.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       12,
	},
	{
		Key:             config.KeyNotificationsRoomClosedEnabled,
		Label:           "Benachrichtigung bei gesperrtem Raum",
		Description:     "Sperrt ihr einen Raum, bekommt das Team einen Hinweis in moto, wenn es in der Zeit dort einen Termin hat. Beginnt die Sperre in den nächsten 14 Tagen, kommt auch eine Mitteilung aufs Handy. Jede Person kann sie selbst ausschalten.",
		Type:            config.FieldBoolean,
		Default:         true,
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "benachrichtigungen",
		SortOrder:       13,
	},
}
