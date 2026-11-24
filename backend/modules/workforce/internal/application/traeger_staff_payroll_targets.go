package application

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// Where the month of an Einsatzort goes (#8041, ADR 0320): which employer
// it belongs to, which file carries it, which Kostenstelle marks it and
// under which personnel number it books.

// payrollBodyTraeger names the Träger as the employer of a file.
const payrollBodyTraeger = "traeger"

// payrollFileTraeger is the key of the one file of the Träger, and of the
// Träger's file per employer while its DATEV client is missing.
const payrollFileTraeger = "traeger"

// payrollTarget is where the month of one Einsatzort books.
type payrollTarget struct {
	fileKey            string
	consultant, client string
	employer           workforce.TraegerPayrollFileEmployer
	costCenter         string
	number             string
	// check names a body besides the Träger, whose values the report checks.
	check *payrollCheckRef
}

type payrollCheckRef struct {
	key        employerKey
	schoolName string
}

// payrollGroup are the months of a contract's Einsatzorte that book at one
// target.
type payrollGroup struct {
	target payrollTarget
	months []schoolPayrollMonth
}

// payrollTargets resolves the employer of every Einsatzort of the month.
type payrollTargets struct {
	settings  workforce.TraegerPayrollSettings
	employers map[int64]workforce.TraegerStaffEmployer
	values    map[employerKey]*domain.TraegerPayrollEmployer
	names     map[int64]string
}

// of is the target of the record's Einsatzort at the school.
func (p payrollTargets) of(record domain.TraegerStaffRecord, schoolID int64) payrollTarget {
	link, _ := recordLink(record, schoolID)
	employer := siteEmployer(p.employers, link.ViaPool, schoolID)
	perEmployer := payrollForm(p.settings) == workforce.TraegerPayrollFormArbeitgeber
	target := payrollTarget{
		fileKey: payrollFileTraeger, consultant: p.settings.ConsultantNumber, client: p.settings.ClientNumber,
		employer: workforce.TraegerPayrollFileEmployer{Body: payrollBodyTraeger},
		number:   domain.Deref(record.PersonnelNumber),
	}
	if employer.Body == "" {
		if perEmployer {
			target.fileKey = clientFileKey(target.consultant, target.client, payrollFileTraeger)
		}
		return target
	}
	key := employerKey{schoolID, employer.Body}
	target.employer = workforce.TraegerPayrollFileEmployer(employer)
	target.check = &payrollCheckRef{key: key, schoolName: p.names[schoolID]}
	values := p.values[key]
	if values == nil {
		values = &domain.TraegerPayrollEmployer{}
	}
	if !perEmployer {
		// The one file: the DATEV client of the Träger, the employer's line
		// marked with its Kostenstelle.
		target.costCenter = values.CostCenter
		return target
	}
	target.consultant, target.client = values.ConsultantNumber, values.ClientNumber
	target.fileKey = clientFileKey(values.ConsultantNumber, values.ClientNumber, fmt.Sprintf("s%d-%s", schoolID, employer.Body))
	if number := link.EmployerNumberFor(employer.Body); number != nil {
		target.number = *number
	}
	return target
}

// clientFileKey is the key of the file of a DATEV client: Berater- and
// Mandantennummer, so two bodies with one client share a file. Without both
// numbers the employer keeps a file of its own, which cannot be made.
func clientFileKey(consultant, client, fallback string) string {
	if consultant == "" || client == "" {
		return fallback
	}
	return consultant + "-" + client
}

// groups splits the months of a contract by their target, in the order of
// the Einsatzorte.
func (p payrollTargets) groups(record domain.TraegerStaffRecord, months []schoolPayrollMonth) []payrollGroup {
	type groupKey struct{ file, costCenter, number string }
	var groups []payrollGroup
	index := map[groupKey]int{}
	for _, month := range months {
		target := p.of(record, month.schoolID)
		key := groupKey{target.fileKey, target.costCenter, target.number}
		i, ok := index[key]
		if !ok {
			i = len(groups)
			index[key] = i
			groups = append(groups, payrollGroup{target: target})
		}
		groups[i].months = append(groups[i].months, month)
	}
	return groups
}
