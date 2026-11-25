package defaults

import (
	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
)

// The Träger values of the payroll file over all schools (#4712, ADR 0089
// section 11). Every value is empty by default, like the school's payroll
// values: the numbers belong to the Träger's DATEV client, and a plausible
// preset would book silently wrong. The file names what is missing. The
// Lohnexport page edits them as one table; the general settings page leaves
// the tab out.
func init() {
	registerDefinitions(traegerPayrollDefinitions())
}

// TraegerPayrollTab is the tab of the payroll values.
const traegerPayrollTab = "lohnexport"

var traegerPayrollCategoryLabels = map[string]string{
	"regelarbeit": "Regelarbeit", "plus_stunden": "Plus-Stunden", "auszahlung": "Auszahlung",
	"freizeitausgleich": "Freizeitausgleich", "krank": "Krank", "urlaub": "Urlaub", "fortbildung": "Fortbildung",
}

var traegerPayrollKindLabels = map[string]string{
	"part_time": "Teilzeit", "full_time": "Vollzeit", "minijob": "Minijob",
	"uebungsleiter": "Übungsleiter", "ehrenamt": "Ehrenamt",
}

func traegerPayrollDefinition(key, category string, order int, label, description string) config.Definition {
	return config.Definition{
		Key:               key,
		Levels:            config.LevelTraeger,
		TraegerWriteRight: config.TraegerRightStaff,
		Label:             label,
		Description:       description,
		Type:              config.FieldText,
		Default:           "",
		ReadPermission:    payrollReadPermission,
		WritePermission:   payrollWritePermission,
		Tab:               traegerPayrollTab,
		Category:          category,
		SortOrder:         order,
		AccessPolicy:      config.AccessAdminOnly,
	}
}

func traegerPayrollDefinitions() []config.Definition {
	consultant := traegerPayrollDefinition(config.KeyTraegerPayrollConsultantNumber, "datev-lohn", 10, "Beraternummer für den Lohn",
		"Die Nummer deines Lohnbüros in DATEV, 1 bis 7 Ziffern. Sie steht oben in der LODAS-Datei. Lohn und Gehalt braucht sie nicht.")
	consultant.Validation = &config.ValidationRules{Pattern: &beraterPattern, AllowEmpty: true}
	client := traegerPayrollDefinition(config.KeyTraegerPayrollClientNumber, "datev-lohn", 20, "Mandantennummer für den Lohn",
		"Deine Nummer beim Lohnbüro in DATEV, 1 bis 5 Ziffern. Sie steht oben in der LODAS-Datei. Lohn und Gehalt braucht sie nicht.")
	client.Validation = &config.ValidationRules{Pattern: &mandantPattern, AllowEmpty: true}
	form := traegerPayrollDefinition(config.KeyTraegerPayrollFileForm, "lohndatei", 5, "Wie viele Lohndateien?",
		"Eine Datei für den ganzen Träger, oder eine Datei pro Arbeitgeber mit seinen eigenen DATEV-Nummern.")
	form.Type, form.Default = config.FieldSelect, config.TraegerPayrollFileFormTraeger
	form.Options = &config.SelectOptions{Static: []config.SelectOption{
		{Label: "Eine Datei für den ganzen Träger", Value: config.TraegerPayrollFileFormTraeger},
		{Label: "Eine Datei pro Arbeitgeber", Value: config.TraegerPayrollFileFormArbeitgeber},
	}}
	definitions := []config.Definition{form, consultant, client}

	order := 100
	for _, category := range config.TraegerPayrollCategories {
		for _, kind := range config.TraegerPayrollContractKinds {
			order++
			wageType := traegerPayrollDefinition(config.TraegerPayrollWageTypeKey(category, kind), "lohnarten", order,
				"Lohnart "+traegerPayrollCategoryLabels[category]+" bei "+traegerPayrollKindLabels[kind],
				"Die Nummer dieser Lohnart in deinem DATEV, 1 bis 4 Ziffern. Ohne Nummer fehlt der Wert in der Lohndatei.")
			wageType.Validation = &config.ValidationRules{Pattern: &lohnartPattern, AllowEmpty: true}
			definitions = append(definitions, wageType)
		}
	}
	for i, category := range config.TraegerPayrollDayCategories {
		unit := traegerPayrollDefinition(config.TraegerPayrollUnitKey(category), "einheiten", 200+i,
			"Einheit "+traegerPayrollCategoryLabels[category],
			"Ob DATEV diese Lohnart in Stunden oder in Tagen erwartet. Das weiß dein Lohnbüro.")
		unit.Type, unit.Options = config.FieldSelect, unitOptions
		definitions = append(definitions, unit)
	}
	return definitions
}
