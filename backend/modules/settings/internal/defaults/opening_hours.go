package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// Regular opening hours of the school (#7654): when the OGS opens and closes
// on each school day. A day with other hours is entered in the school
// calendar beside the closing days and replaces these on that day.
func init() {
	labels := map[string]string{
		"monday": "Montag", "tuesday": "Dienstag", "wednesday": "Mittwoch",
		"thursday": "Donnerstag", "friday": "Freitag",
	}
	for index, weekday := range config.OpeningHoursWeekdays {
		day := labels[weekday]
		config.Register(openingHoursDefinition(weekday, config.OpeningHoursOpen, "Öffnet am "+day, 2*index+1,
			"Ab dieser Uhrzeit ist die OGS am "+day+" geöffnet. Leer heißt: nicht eingetragen."))
		config.Register(openingHoursDefinition(weekday, config.OpeningHoursClose, "Schließt am "+day, 2*index+2,
			"Bis zu dieser Uhrzeit ist die OGS am "+day+" geöffnet. Leer heißt: nicht eingetragen."))
	}
}

func openingHoursDefinition(weekday, edge, label string, sortOrder int, description string) config.Definition {
	return config.Definition{
		Key:             config.OpeningHoursKey(weekday, edge),
		Label:           label,
		Description:     description,
		Type:            config.FieldTime,
		Default:         "",
		ReadPermission:  "config:read",
		WritePermission: "config:update",
		Tab:             "operations",
		Category:        "oeffnungszeiten",
		SortOrder:       sortOrder,
		AccessPolicy:    config.AccessShared,
	}
}
