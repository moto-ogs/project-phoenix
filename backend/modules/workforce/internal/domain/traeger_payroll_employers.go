package domain

import (
	"regexp"
	"strings"
	"time"
)

// TraegerPayrollEmployer are the stored payroll values of a body that
// employs the staff of a school in place of the Träger (#8041, ADR 0320):
// the DATEV client of its own payroll file and the Kostenstelle of its
// lines in the one file of the Träger.
type TraegerPayrollEmployer struct {
	OrganizationID   int64
	SchoolID         int64
	Body             string
	ConsultantNumber string
	ClientNumber     string
	CostCenter       string
	UpdatedAt        time.Time
}

// The fields of the payroll values, as the request names them.
const (
	PayrollEmployerFieldBody       = "body"
	PayrollEmployerFieldConsultant = "consultant_number"
	PayrollEmployerFieldClient     = "client_number"
	PayrollEmployerFieldCostCenter = "cost_center"
)

// The digits DATEV takes: a Beraternummer of 1 to 7, a Mandantennummer of 1
// to 5 (the patterns of traeger_payroll.datev_*), a Kostenstelle of 1 to 8,
// which LODAS and Lohn und Gehalt both read.
var (
	payrollConsultantPattern = regexp.MustCompile(`^[0-9]{1,7}$`)
	payrollClientPattern     = regexp.MustCompile(`^[0-9]{1,5}$`)
	payrollCostCenterPattern = regexp.MustCompile(`^[0-9]{1,8}$`)
)

// NormalizePayrollEmployer trims the values and names the first field that
// is not empty and not a number DATEV takes.
func NormalizePayrollEmployer(value TraegerPayrollEmployer) (TraegerPayrollEmployer, string) {
	value.ConsultantNumber = strings.TrimSpace(value.ConsultantNumber)
	value.ClientNumber = strings.TrimSpace(value.ClientNumber)
	value.CostCenter = strings.TrimSpace(value.CostCenter)
	for _, field := range []struct {
		name, value string
		pattern     *regexp.Regexp
	}{
		{PayrollEmployerFieldConsultant, value.ConsultantNumber, payrollConsultantPattern},
		{PayrollEmployerFieldClient, value.ClientNumber, payrollClientPattern},
		{PayrollEmployerFieldCostCenter, value.CostCenter, payrollCostCenterPattern},
	} {
		if field.value != "" && !field.pattern.MatchString(field.value) {
			return value, field.name
		}
	}
	return value, ""
}
