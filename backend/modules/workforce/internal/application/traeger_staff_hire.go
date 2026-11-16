package application

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// „Person einstellen“ (#7206, ADR 0254). A hire checks everything first: the
// release, the personnel number at the Träger and at each Einsatzort, and
// whether the Träger or one of its schools keeps a person with this name and
// birthday. Then each Einsatzort gets the person and the employment in its
// own tenant transaction, and one Träger transaction saves the record, its
// Einsatzorte and the contract; no transaction carries both (ADR 0105). A
// hire that fails between the two answers as incomplete and names what
// exists: the people it created stand under „Ohne Akte“, where the
// Personalverwaltung completes it.

var _ workforce.TraegerStaffHires = (*TraegerStaff)(nil)

var errHiresUnbound = errors.New("workforce: the school hires are not bound")

// noteHiredByTraeger is the note the school's audit trail carries for the
// values a hire brings.
const noteHiredByTraeger = "Vom Träger eingestellt"

// Hire creates the record, the contract and the employments of a new person.
func (t *TraegerStaff) Hire(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.TraegerStaffHireInput) (workforce.TraegerStaffRecordDetail, error) {
	if t.ports.HirePersons == nil || t.ports.HireEmployments == nil {
		return workforce.TraegerStaffRecordDetail{}, errHiresUnbound
	}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, err
	}
	names := schoolNames(schools)
	hire, err := t.checkHire(ctx, actor, input, schools)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicHireError(err, names)
	}
	links, err := t.hireAtSchools(ctx, actor, hire)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, hireIncomplete(err, 0, links, names)
	}
	var record domain.TraegerStaffRecord
	err = t.released(ctx, actor, func(ctx context.Context) error {
		record, err = t.writeHire(ctx, actor, hire, links)
		return err
	})
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, hireIncomplete(publicHireError(err, names), 0, links, names)
	}
	failed := t.handOverHire(ctx, actor, record)
	unmirrored, err := t.mirror(ctx, actor, record.ID, nil)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, hireIncomplete(err, record.ID, links, names)
	}
	detail, err := t.Record(ctx, actor, record.ID)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, hireIncomplete(err, record.ID, links, names)
	}
	for _, link := range links {
		if slices.Contains(failed, link.SchoolID) || slices.Contains(unmirrored, link.SchoolID) {
			detail.UnsyncedSchools = append(detail.UnsyncedSchools, names[link.SchoolID])
		}
	}
	return detail, nil
}

// hireAtSchools creates the person and the employment at every Einsatzort,
// each in its own tenant transaction. It returns the employments it created,
// also when a later school fails: those people exist then.
func (t *TraegerStaff) hireAtSchools(ctx context.Context, actor workforce.TraegerStaffActor, hire domain.StaffHire) ([]domain.TraegerStaffLink, error) {
	links := make([]domain.TraegerStaffLink, 0, len(hire.Sites))
	for _, site := range hire.Sites {
		var staffID int64
		err := t.ports.Runtime.WithinSchool(ctx, site.SchoolID, func(ctx context.Context) error {
			var err error
			staffID, err = t.hireAtSchool(ctx, actor, hire)
			return err
		})
		if err != nil {
			return links, fmt.Errorf("hire at school %d: %w", site.SchoolID, err)
		}
		links = append(links, domain.TraegerStaffLink{SchoolID: site.SchoolID, StaffID: staffID})
	}
	return links, nil
}

// handOverHire gives every Einsatzort the record's personnel number, each in
// its own tenant transaction. The hire is saved by then, so a school that
// fails is named and catches up with the next write of the record (ADR 0233
// section 6) instead of failing the hire.
func (t *TraegerStaff) handOverHire(ctx context.Context, actor workforce.TraegerStaffActor, record domain.TraegerStaffRecord) []int64 {
	var failed []int64
	for _, link := range record.Links {
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			return t.handOverSchool(ctx, actor, link.StaffID, record.PersonnelNumber)
		})
		if err != nil {
			t.warn("traeger hire hand-over failed", "school_id", link.SchoolID, "staff_record_id", record.ID, "error", err)
			failed = append(failed, link.SchoolID)
		}
	}
	return failed
}

// hireIncomplete reports a hire that failed after it created something: the
// people of links exist at their schools and, with recordID, the record too.
// A failure before anything was created stays what it is.
func hireIncomplete(err error, recordID int64, links []domain.TraegerStaffLink, names map[int64]string) error {
	if recordID == 0 && len(links) == 0 {
		return err
	}
	incomplete := &workforce.TraegerStaffHireIncompleteError{RecordID: recordID, Cause: err}
	for _, link := range links {
		incomplete.Schools = append(incomplete.Schools, names[link.SchoolID])
	}
	return incomplete
}

// checkHire validates the hire and refuses it before anything is created:
// an Einsatzort that is no school of the Träger, a taken personnel number,
// and, unless confirmed, a person who may exist already.
func (t *TraegerStaff) checkHire(ctx context.Context, actor workforce.TraegerStaffActor, input workforce.TraegerStaffHireInput, schools []workforce.TraegerStaffSchool) (domain.StaffHire, error) {
	hire := domain.StaffHire{
		FirstName: input.FirstName, LastName: input.LastName, Birthday: input.Birthday, Email: input.Email, Phone: input.Phone,
		PersonnelNumber: input.PersonnelNumber, Kind: input.Kind, StartsOn: input.StartsOn,
	}
	if input.EndsOn != nil {
		hire.EndsOn = *input.EndsOn
	}
	for _, site := range input.Sites {
		hire.Sites = append(hire.Sites, domain.StaffHireSite{SchoolID: site.SchoolID, WeekdayMinutes: site.WeekdayMinutes})
	}
	hire, err := domain.NormalizeStaffHire(hire, calendar.Date(t.clock.Today()))
	if err != nil {
		return domain.StaffHire{}, err
	}
	names := schoolNames(schools)
	for _, site := range hire.Sites {
		if _, ok := names[site.SchoolID]; !ok {
			return domain.StaffHire{}, &domain.StaffHireError{Field: "sites", Reason: "an Einsatzort is not one of the Träger's schools"}
		}
	}
	matches, err := t.hireRecordMatches(ctx, actor, hire)
	if err != nil {
		return domain.StaffHire{}, err
	}
	schoolMatches, err := t.hireSchoolMatches(ctx, hire, schools)
	if err != nil {
		return domain.StaffHire{}, err
	}
	if len(matches)+len(schoolMatches) == 0 || input.ConfirmDuplicate {
		return hire, nil
	}
	// The answer names people of these schools: each school's access log
	// gets its entry before anything leaves (ADR 0084 section 7).
	for _, match := range schoolMatches {
		matches = append(matches, workforce.TraegerStaffHireMatch{Kind: workforce.TraegerStaffHireMatchSchool, SchoolID: match.school.ID, SchoolName: match.school.Name})
		err := t.ports.Runtime.WithinSchool(ctx, match.school.ID, func(ctx context.Context) error {
			return t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
				OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: workforce.TraegerStaffViewHireCheck,
				Rows: len(match.staffIDs), StaffIDs: match.staffIDs,
			})
		})
		if err != nil {
			return domain.StaffHire{}, err
		}
	}
	return domain.StaffHire{}, &workforce.TraegerStaffHireDuplicateError{Matches: matches}
}

// hireRecordMatches reads the Träger's records after the release check: a
// record with the hire's number refuses it, a record with its name and
// birthday is a match.
func (t *TraegerStaff) hireRecordMatches(ctx context.Context, actor workforce.TraegerStaffActor, hire domain.StaffHire) ([]workforce.TraegerStaffHireMatch, error) {
	var records []domain.TraegerStaffRecord
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		records, err = t.store.ListStaffRecords(ctx, actor.OrganizationID)
		return err
	})
	if err != nil {
		return nil, err
	}
	var matches []workforce.TraegerStaffHireMatch
	for _, record := range records {
		if hire.PersonnelNumber != nil && domain.Deref(record.PersonnelNumber) == *hire.PersonnelNumber {
			return nil, workforce.ErrPersonnelNumberTaken
		}
		if hire.SamePerson(record.FirstName, record.LastName, record.Birthday) {
			matches = append(matches, workforce.TraegerStaffHireMatch{Kind: workforce.TraegerStaffHireMatchRecord, RecordID: record.ID})
		}
	}
	return matches, nil
}

// hireSchoolMatch is one school with employments of the hire's name and
// birthday that no record holds.
type hireSchoolMatch struct {
	school   workforce.TraegerStaffSchool
	staffIDs []int64
}

// hireSchoolMatches reads the live employments of every school of the
// Träger, each in its own tenant transaction. An Einsatzort that holds the
// hire's number refuses it. A school with a person of the hire's name and
// birthday is a match. A person a record holds already is the record's
// match, so those employments stay out.
func (t *TraegerStaff) hireSchoolMatches(ctx context.Context, hire domain.StaffHire, schools []workforce.TraegerStaffSchool) ([]hireSchoolMatch, error) {
	sites := make(map[int64]bool, len(hire.Sites))
	for _, site := range hire.Sites {
		sites[site.SchoolID] = true
	}
	var matches []hireSchoolMatch
	for _, school := range schools {
		var same []int64
		err := t.ports.Runtime.WithinSchool(ctx, school.ID, func(ctx context.Context) error {
			members, err := t.schoolStaff(ctx, nil)
			if err != nil {
				return err
			}
			if same, err = samePeople(hire, members, sites[school.ID]); err != nil {
				return err
			}
			same, err = t.withoutRecord(ctx, same)
			return err
		})
		if err != nil {
			return nil, err
		}
		if len(same) > 0 {
			matches = append(matches, hireSchoolMatch{school: school, staffIDs: same})
		}
	}
	return matches, nil
}

// samePeople lists the employments of one school whose person shares the
// hire's name and birthday. At an Einsatzort an employment that holds the
// hire's personnel number refuses the hire.
func samePeople(hire domain.StaffHire, members []workforce.TraegerSchoolStaffMember, einsatzort bool) ([]int64, error) {
	var same []int64
	for _, member := range members {
		if einsatzort && hire.PersonnelNumber != nil && domain.Deref(member.PersonnelNumber) == *hire.PersonnelNumber {
			return nil, workforce.ErrPersonnelNumberTaken
		}
		if hire.SamePerson(member.FirstName, member.LastName, member.Birthday) {
			same = append(same, member.StaffID)
		}
	}
	return same, nil
}

// withoutRecord keeps the employments of the school of the tenant
// transaction that no record of the Träger holds.
func (t *TraegerStaff) withoutRecord(ctx context.Context, staffIDs []int64) ([]int64, error) {
	if len(staffIDs) == 0 {
		return nil, nil
	}
	kept, err := t.store.KeptStaffIDs(ctx, staffIDs)
	if err != nil {
		return nil, err
	}
	held := make(map[int64]bool, len(kept))
	for _, staffID := range kept {
		held[staffID] = true
	}
	free := make([]int64, 0, len(staffIDs))
	for _, staffID := range staffIDs {
		if !held[staffID] {
			free = append(free, staffID)
		}
	}
	return free, nil
}

// hireAtSchool creates the person and the employment in the school of the
// tenant transaction and fills the school's personnel record with what the
// school needs of the hire. The personnel number follows with the hand-over,
// once the record holds the employment.
func (t *TraegerStaff) hireAtSchool(ctx context.Context, actor workforce.TraegerStaffActor, hire domain.StaffHire) (int64, error) {
	personID, err := t.ports.HirePersons.CreateSchoolPerson(ctx, workforce.TraegerSchoolPersonInput{
		FirstName: hire.FirstName, LastName: hire.LastName, Birthday: hire.Birthday,
	})
	if err != nil {
		return 0, fmt.Errorf("create person: %w", err)
	}
	staffID, err := t.ports.HireEmployments.CreateSchoolEmployment(ctx, workforce.TraegerSchoolEmploymentInput{
		PersonID: personID, EmploymentType: domain.SchoolEmploymentType(hire.Kind),
	})
	if err != nil {
		return 0, fmt.Errorf("create employment: %w", err)
	}
	return staffID, t.fillHiredMasterData(ctx, actor, staffID, hire)
}

// fillHiredMasterData writes entry day, last day, address and phone of a
// hire into the school's master data of the new employment, each value with
// its entry in the school's audit trail, written before the row.
func (t *TraegerStaff) fillHiredMasterData(ctx context.Context, actor workforce.TraegerStaffActor, staffID int64, hire domain.StaffHire) error {
	contract := domain.ContractSection{EntryDate: new(hire.StartsOn.String())}
	if !hire.EndsOn.IsZero() {
		contract.ContractEndDate = new(hire.EndsOn.String())
	}
	contact := domain.ContactSection{Email: hire.Email, Phone: hire.Phone}
	sections := []struct {
		name    string
		changes []domain.FieldChange
	}{
		{domain.AuditSectionArbeitsvertrag, domain.ContractChanges(domain.StaffSubject{}, nil, contract)},
		{domain.AuditSectionKontakt, domain.ContactChanges(nil, contact)},
	}
	for _, section := range sections {
		for _, change := range section.changes {
			if err := t.audit.RecordMasterDataChange(ctx, domain.MasterDataChange{
				StaffID: staffID, ChangedBy: actor.AccountID, Section: section.name,
				Field: change.Field, OldValue: change.OldValue, NewValue: change.NewValue, Note: noteHiredByTraeger,
			}); err != nil {
				return fmt.Errorf("write hire audit: %w", err)
			}
		}
	}
	return t.store.InsertSchoolHireData(ctx, domain.StaffMasterData{
		StaffID: staffID, EntryDate: domain.Deref(contract.EntryDate), ContractEndDate: domain.Deref(contract.ContractEndDate),
		Email: contact.Email, Phone: contact.Phone,
	})
}

// writeHire saves the record, its Einsatzorte, the contract and the trail
// in the Träger transaction.
func (t *TraegerStaff) writeHire(ctx context.Context, actor workforce.TraegerStaffActor, hire domain.StaffHire, links []domain.TraegerStaffLink) (domain.TraegerStaffRecord, error) {
	record := domain.TraegerStaffRecord{
		OrganizationID: actor.OrganizationID, FirstName: hire.FirstName, LastName: hire.LastName, Birthday: hire.Birthday,
		PersonnelNumber: hire.PersonnelNumber,
	}
	id, err := t.store.SaveStaffRecord(ctx, record)
	if err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	record.ID, record.Links = id, links
	if err := t.store.InsertStaffLinks(ctx, actor.OrganizationID, id, actor.AccountID, links); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	contract := domain.TraegerStaffContract{OrganizationID: actor.OrganizationID, RecordID: id, Kind: hire.Kind, StartsOn: hire.StartsOn, EndsOn: hire.EndsOn}
	live := make([]domain.ContractSite, 0, len(links))
	changes := make([]domain.TraegerStaffChange, 0, len(links)+1)
	for i, link := range links {
		site := domain.ContractSite{SchoolID: link.SchoolID, StaffID: link.StaffID}
		live = append(live, site)
		contract.Targets = append(contract.Targets, domain.ContractTarget{ContractSite: site, ValidFrom: hire.StartsOn, WeekdayMinutes: hire.Sites[i].WeekdayMinutes})
		changes = append(changes, domain.TraegerStaffChange{
			RecordID: id, Kind: domain.StaffChangeLinked, Field: domain.StaffChangeFieldSchool, SchoolID: new(link.SchoolID), AccountID: actor.AccountID,
		})
	}
	if err := domain.ValidateContract(contract, live, nil); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	if _, err := t.store.InsertStaffContract(ctx, contract, actor.AccountID); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	changes = append(changes, domain.TraegerStaffChange{
		RecordID: id, Kind: domain.StaffChangeAdded, Field: domain.StaffChangeFieldContract, ValueText: new(contractText(contract)), AccountID: actor.AccountID,
	})
	return record, t.store.AppendStaffChanges(ctx, actor.OrganizationID, changes)
}

// publicHireError maps the refusals of a hire onto the public contract.
func publicHireError(err error, names map[int64]string) error {
	if hire, ok := errors.AsType[*domain.StaffHireError](err); ok {
		return &workforce.TraegerStaffHireError{Field: hire.Field, Reason: hire.Reason}
	}
	return publicContractError(err, names)
}
