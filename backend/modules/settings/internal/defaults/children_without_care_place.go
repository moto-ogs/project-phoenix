package defaults

import config "github.com/moto-ogs/project-phoenix/modules/settings/records"

// Children without an OGS place (#4803, ADR 0282): the moto team switches
// them on per school, after the school has booked Unterricht am Vormittag.
// Module switches default to booked, so this one carries the activation and
// defaults to off; switching it on converts the school's class list entries.
func init() {
	registerDefinitions([]config.Definition{{
		Key:   config.KeyChildrenWithoutCarePlace,
		Label: "Kinder ohne OGS-Platz in der Eltern-App",
		Description: "Kinder der Klasse ohne OGS-Platz bekommen einen eigenen Eintrag in moto. " +
			"Ihre Eltern können sie dann über die Eltern-App krankmelden und bekommen Elternbriefe. " +
			"Beim Einschalten werden die Einträge der Klassenliste übernommen.",
		Type:            config.FieldBoolean,
		Default:         false,
		ReadPermission:  "config:read",
		WritePermission: "config:manage",
		Tab:             "modules",
		Category:        "kinder-ohne-ogs-platz",
		SortOrder:       100,
		AccessPolicy:    config.AccessOperatorManaged,
		DependsOn:       config.DependsOnEq(config.KeyModuleUnterrichtVormittag, true),
	}})
}
