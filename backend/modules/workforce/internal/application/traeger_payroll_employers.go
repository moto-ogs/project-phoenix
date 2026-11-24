package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The employers besides the Träger (#8041, ADR 0320): the payroll values of
// a Schulträger or a Gemeinde that employs the staff of a school, and the
// personnel number a person has with it at one Einsatzort. Both are payroll
// values of the Personalverwaltung, written in the Träger transaction; the
// body itself and which body employs come from Organisation & Tenancy
// through the port Employers.

// PayrollEmployers lists the schools whose staff a body employs, in school
// order, with its stored payroll values.
func (t *TraegerStaff) PayrollEmployers(ctx context.Context, actor workforce.TraegerStaffActor) (workforce.TraegerPayrollEmployerList, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerPayrollEmployerList{}, err
	}
	list := workforce.TraegerPayrollEmployerList{Employers: []workforce.TraegerPayrollEmployerValues{}}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		employers, values, err := t.payrollEmployers(ctx, actor.OrganizationID, schoolIDs(schools))
		if err != nil {
			return err
		}
		for _, school := range schools {
			employer, ok := employers[school.ID.Int64()]
			if !ok {
				continue
			}
			list.Employers = append(list.Employers, publicPayrollEmployer(school, employer, values[employerKey{school.ID.Int64(), employer.Body}]))
		}
		return nil
	})
	if err != nil {
		return workforce.TraegerPayrollEmployerList{}, publicTraegerStaffError(err)
	}
	return list, nil
}

// SavePayrollEmployer stores the payroll values of the body at the school.
func (t *TraegerStaff) SavePayrollEmployer(ctx context.Context, actor workforce.TraegerStaffActor, schoolID int64,
	input workforce.TraegerPayrollEmployerInput,
) (workforce.TraegerPayrollEmployerValues, error) {
	value, err := payrollEmployerValue(actor, schoolID, input)
	if err != nil {
		return workforce.TraegerPayrollEmployerValues{}, err
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerPayrollEmployerValues{}, err
	}
	school, ok := findSchool(schools, schoolID)
	if !ok {
		return workforce.TraegerPayrollEmployerValues{}, workforce.ErrTraegerStaffEmployerChanged
	}
	var saved workforce.TraegerPayrollEmployerValues
	err = t.released(ctx, actor, func(ctx context.Context) error {
		employer, err := t.currentEmployer(ctx, actor.OrganizationID, schoolID, input.Body)
		if err != nil {
			return err
		}
		stored, err := t.store.LockPayrollEmployer(ctx, actor.OrganizationID, schoolID, input.Body)
		if err != nil {
			return err
		}
		if err := readstate.Check(input.ExpectedVersion, payrollEmployerVersion(stored)); err != nil {
			return err
		}
		written, ok, err := t.store.SavePayrollEmployer(ctx, value, actor.AccountID, stored == nil)
		if err != nil {
			return err
		}
		if !ok {
			// Another save stored the first values meanwhile.
			return readstate.ErrChanged
		}
		saved = publicPayrollEmployer(school, employer, &written)
		return nil
	})
	if err != nil {
		return workforce.TraegerPayrollEmployerValues{}, publicTraegerStaffError(err)
	}
	return saved, nil
}

// payrollEmployerValue checks the body and the numbers of a save.
func payrollEmployerValue(actor workforce.TraegerStaffActor, schoolID int64, input workforce.TraegerPayrollEmployerInput) (domain.TraegerPayrollEmployer, error) {
	if input.Body != workforce.TraegerEmployerSchultraeger && input.Body != workforce.TraegerEmployerGemeinde {
		return domain.TraegerPayrollEmployer{}, &workforce.TraegerPayrollEmployerError{Field: domain.PayrollEmployerFieldBody}
	}
	value, field := domain.NormalizePayrollEmployer(domain.TraegerPayrollEmployer{
		OrganizationID: actor.OrganizationID, SchoolID: schoolID, Body: input.Body,
		ConsultantNumber: input.ConsultantNumber, ClientNumber: input.ClientNumber, CostCenter: input.CostCenter,
	})
	if field != "" {
		return domain.TraegerPayrollEmployer{}, &workforce.TraegerPayrollEmployerError{Field: field}
	}
	return value, nil
}

// UpdateEmployerNumber sets the personnel number of the record with the
// body that employs at its Einsatzort schoolID.
func (t *TraegerStaff) UpdateEmployerNumber(ctx context.Context, actor workforce.TraegerStaffActor, recordID, schoolID int64,
	value *string, expectedVersion string,
) (workforce.TraegerStaffRecordDetail, error) {
	number, err := domain.NormalizePersonnelNumber(value)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		return t.setEmployerNumber(ctx, actor, recordID, schoolID, number, expectedVersion)
	})
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	return t.Record(ctx, actor, recordID)
}

// setEmployerNumber writes the number and its trail entry under the lock of
// the record, in the caller's Träger transaction.
func (t *TraegerStaff) setEmployerNumber(ctx context.Context, actor workforce.TraegerStaffActor, recordID, schoolID int64,
	number *string, expectedVersion string,
) error {
	record, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
	if err != nil {
		return err
	}
	link, ok := recordLink(record, schoolID)
	if !ok {
		return domain.ErrTraegerStaffRecordMissing
	}
	employers, err := t.employers(ctx, actor.OrganizationID, record)
	if err != nil {
		return err
	}
	employer := siteEmployer(employers, link.ViaPool, schoolID)
	current := link.EmployerNumberFor(employer.Body)
	if err := readstate.Check(expectedVersion, employerNumberVersion(employer.Body, current)); err != nil {
		return err
	}
	if employer.Body == "" {
		return workforce.ErrTraegerStaffEmployerChanged
	}
	if domain.Deref(current) == domain.Deref(number) {
		return nil
	}
	change, err := t.trailChange(actor.OrganizationID, domain.TraegerStaffChange{
		RecordID: recordID, Kind: domain.StaffChangeChanged, Field: domain.StaffFieldEmployerNumber,
		SchoolID: &schoolID, AccountID: actor.AccountID,
	}, domain.Deref(current))
	if err != nil {
		return err
	}
	if err := t.store.SetLinkEmployerNumber(ctx, actor.OrganizationID, recordID, schoolID, employer.Body, number); err != nil {
		return err
	}
	return t.store.AppendStaffChanges(ctx, actor.OrganizationID, []domain.TraegerStaffChange{change})
}

// employerKey names the payroll values of one body at one school.
type employerKey struct {
	school int64
	body   string
}

// payrollEmployers reads which body employs at the schools and the stored
// payroll values of the Träger, in the caller's Träger transaction.
func (t *TraegerStaff) payrollEmployers(ctx context.Context, organizationID int64, schoolIDs []int64,
) (map[int64]workforce.TraegerStaffEmployer, map[employerKey]*domain.TraegerPayrollEmployer, error) {
	employers := map[int64]workforce.TraegerStaffEmployer{}
	if t.ports.Employers != nil && len(schoolIDs) > 0 {
		read, err := t.ports.Employers.SchoolEmployers(ctx, organizationID, schoolIDs)
		if err != nil {
			return nil, nil, fmt.Errorf("workforce: employers of the schools: %w", err)
		}
		employers = read
	}
	stored, err := t.store.ListPayrollEmployers(ctx, organizationID)
	if err != nil {
		return nil, nil, err
	}
	values := make(map[employerKey]*domain.TraegerPayrollEmployer, len(stored))
	for i := range stored {
		values[employerKey{stored[i].SchoolID, stored[i].Body}] = &stored[i]
	}
	return employers, values, nil
}

// currentEmployer is the body that employs at the school, which must be
// body.
func (t *TraegerStaff) currentEmployer(ctx context.Context, organizationID, schoolID int64, body string) (workforce.TraegerStaffEmployer, error) {
	if t.ports.Employers == nil {
		return workforce.TraegerStaffEmployer{}, workforce.ErrTraegerStaffEmployerChanged
	}
	employers, err := t.ports.Employers.SchoolEmployers(ctx, organizationID, []int64{schoolID})
	if err != nil {
		return workforce.TraegerStaffEmployer{}, fmt.Errorf("workforce: employer of the school: %w", err)
	}
	employer, ok := employers[schoolID]
	if !ok || employer.Body != body {
		return workforce.TraegerStaffEmployer{}, workforce.ErrTraegerStaffEmployerChanged
	}
	return employer, nil
}

func publicPayrollEmployer(school workforce.TraegerStaffSchool, employer workforce.TraegerStaffEmployer,
	stored *domain.TraegerPayrollEmployer,
) workforce.TraegerPayrollEmployerValues {
	values := workforce.TraegerPayrollEmployerValues{
		SchoolID: school.ID, SchoolName: school.Name, Body: employer.Body, Name: employer.Name,
		Version: payrollEmployerVersion(stored),
	}
	if stored != nil {
		values.ConsultantNumber, values.ClientNumber, values.CostCenter = stored.ConsultantNumber, stored.ClientNumber, stored.CostCenter
	}
	return values
}

// payrollEmployerVersion is the read state of stored payroll values (ADR
// 0311); readstate.Absent while none are stored.
func payrollEmployerVersion(stored *domain.TraegerPayrollEmployer) string {
	if stored == nil {
		return readstate.Absent
	}
	return readstate.Of(stored.UpdatedAt)
}

func findSchool(schools []workforce.TraegerStaffSchool, schoolID int64) (workforce.TraegerStaffSchool, bool) {
	for _, school := range schools {
		if school.ID == ident.ID(schoolID) {
			return school, true
		}
	}
	return workforce.TraegerStaffSchool{}, false
}

func recordLink(record domain.TraegerStaffRecord, schoolID int64) (domain.TraegerStaffLink, bool) {
	for _, link := range record.Links {
		if link.SchoolID == schoolID {
			return link, true
		}
	}
	return domain.TraegerStaffLink{}, false
}
