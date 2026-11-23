package application

import (
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Section tokens of the personnel record (ADR 0311). Each section has its
// own fingerprint over the stored values it shows, so saving one section
// never refuses the next save of another one on the same rows. The read and
// the check under the staff lock call the same function.

// StammdatenVersions holds the token of each non-sensitive section.
type StammdatenVersions struct {
	Person          string
	Kontakt         string
	Arbeitsvertrag  string
	Qualifikationen string
}

func stammdatenVersions(subject domain.StaffSubject, masterData *domain.StaffMasterData, qualifications []domain.StaffQualification) StammdatenVersions {
	return StammdatenVersions{
		Person:          personSectionVersion(subject, masterData),
		Kontakt:         contactSectionVersion(masterData),
		Arbeitsvertrag:  contractSectionVersion(subject, masterData),
		Qualifikationen: qualificationsVersion(qualifications),
	}
}

func storedMasterData(masterData *domain.StaffMasterData) domain.StaffMasterData {
	if masterData == nil {
		return domain.StaffMasterData{}
	}
	return *masterData
}

func personSectionVersion(subject domain.StaffSubject, masterData *domain.StaffMasterData) string {
	md := storedMasterData(masterData)
	return readstate.Fingerprint([]any{subject.FirstName, subject.LastName, subject.Birthday, md.Gender})
}

func contactSectionVersion(masterData *domain.StaffMasterData) string {
	md := storedMasterData(masterData)
	return readstate.Fingerprint([]any{
		md.AddressStreet, md.AddressPostalCode, md.AddressCity, md.Phone, md.Email,
		md.EmergencyContactName, md.EmergencyContactPhone,
	})
}

func contractSectionVersion(subject domain.StaffSubject, masterData *domain.StaffMasterData) string {
	md := storedMasterData(masterData)
	return readstate.Fingerprint([]any{md.EntryDate, md.ContractEndDate, md.ProbationEndDate, md.WeeklyHours, subject.EmploymentType})
}

func qualificationsVersion(rows []domain.StaffQualification) string {
	state := make([][]any, 0, len(rows))
	for _, row := range rows {
		state = append(state, []any{row.ID, row.TypeID, row.Name, row.AcquiredOn, row.ExpiresOn})
	}
	return readstate.Fingerprint(state)
}

// financialSectionVersion is the token of the bank and tax section: its
// sealed values, never the plaintext (bankRowState). A row without values
// shows what no row shows, so both have the same token; the reveal answers
// an empty record for either.
func financialSectionVersion(data *domain.StaffFinancialData) string {
	if data == nil || (data.IBANSealed == nil && data.TaxIDSealed == nil && data.SocialSecurityNumberSealed == nil) {
		return bankRowState(nil)
	}
	return bankRowState([]domain.StaffFinancialData{*data})
}

// checkSection refuses a section write whose token is not the stored one.
// Nil is a system write that showed no read (ADR 0311 §2 binds edits).
func checkSection(expected *string, current string) error {
	if expected == nil {
		return nil
	}
	return readstate.Check(*expected, current)
}
