package records

// The Träger values of the payroll file over all schools (#4712, ADR 0089
// section 11): the DATEV client of the Lohn and a Lohnart per category and
// kind of Arbeitsvertrag, so Minijob, Übungsleiter and Ehrenamt book on
// their own Lohnarten. They are separate from the Elternabrechnung's DATEV
// client (parent_billing.datev_*, #4694) and from the school's payroll
// values (payroll.*), which do not apply to the Träger's file. Only the
// Träger sets them (LevelTraeger), with the right „Personal“.
const (
	KeyTraegerPayrollConsultantNumber = "traeger_payroll.datev_consultant_number"
	KeyTraegerPayrollClientNumber     = "traeger_payroll.datev_client_number"
	// KeyTraegerPayrollFileForm chooses one file for the whole Träger or one
	// file per employer (#8041, ADR 0319).
	KeyTraegerPayrollFileForm = "traeger_payroll.file_form"
)

// The values of KeyTraegerPayrollFileForm: one file for the whole Träger,
// whose lines of another employer carry its Kostenstelle, or one file per
// employer with its own DATEV client.
const (
	TraegerPayrollFileFormTraeger     = "traeger"
	TraegerPayrollFileFormArbeitgeber = "arbeitgeber"
)

// TraegerPayrollCategories are the categories of the payroll file, the
// categories of the school's file (payroll.lohnart_*), in file order.
var TraegerPayrollCategories = []string{
	"regelarbeit", "plus_stunden", "auszahlung", "freizeitausgleich", "krank", "urlaub", "fortbildung",
}

// TraegerPayrollDayCategories may book in days; their unit is a Träger
// value.
var TraegerPayrollDayCategories = []string{"krank", "urlaub", "fortbildung"}

// TraegerPayrollContractKinds are the kinds of an Arbeitsvertrag of the
// Träger (workforce.TraegerContractKinds).
var TraegerPayrollContractKinds = []string{"part_time", "full_time", "minijob", "uebungsleiter", "ehrenamt"}

// TraegerPayrollWageTypeKey is the key of the Lohnart of category for the
// kind of contract, e.g. traeger_payroll.wage_type.krank.minijob.
func TraegerPayrollWageTypeKey(category, kind string) string {
	return "traeger_payroll.wage_type." + category + "." + kind
}

// TraegerPayrollUnitKey is the key of the unit of a day category.
func TraegerPayrollUnitKey(category string) string {
	return "traeger_payroll.unit." + category
}
