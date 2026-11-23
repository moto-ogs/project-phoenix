package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Notes the schools' audit trail carries for a change of the Träger.
const (
	noteHandedToTraeger   = "An die Personalakte des Trägers übergeben"
	noteNumberOfTraeger   = "Personalnummer aus der Personalakte des Trägers"
	noteReturnedByTraeger = "Personalakte des Trägers aufgelöst, Werte an die Schule zurückgegeben"
	// actorRoleTraeger is the role of a Träger account in a school's access
	// log: it holds no role of the school.
	actorRoleTraeger = "traeger"
)

// writeLink saves the record, its new Einsatzorte and the trail in the
// Träger transaction. An existing record is locked first, so two links of
// one record wait for each other, and a record changed since the link read
// it is refused (ADR 0311): the choices were made on its values.
func (t *TraegerStaff) writeLink(ctx context.Context, actor workforce.TraegerStaffActor, plan linkPlan, resolved domain.ResolvedStaffFields) (domain.TraegerStaffRecord, error) {
	record, before, err := t.lockLinkRecord(ctx, actor, plan)
	if err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	values := resolved.Values
	record.FirstName, record.LastName = strings.TrimSpace(values[domain.StaffFieldFirstName]), strings.TrimSpace(values[domain.StaffFieldLastName])
	if record.FirstName == "" || record.LastName == "" {
		return domain.TraegerStaffRecord{}, &workforce.TraegerStaffLinkError{Field: "members", Reason: "a record needs a first and a last name"}
	}
	record.Birthday = values[domain.StaffFieldBirthday]
	record.PersonnelNumber = nil
	if number := values[domain.StaffFieldPersonnelNumber]; number != "" {
		record.PersonnelNumber = &number
	}
	id, err := t.store.SaveStaffRecord(ctx, record)
	if err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	record.ID = id
	if err := t.sealRecordFinancial(&record, values); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	if err := t.store.SealStaffRecord(ctx, record); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	links := make([]domain.TraegerStaffLink, 0, len(plan.members))
	for _, member := range plan.members {
		links = append(links, domain.TraegerStaffLink{SchoolID: member.ref.SchoolID.Int64(), StaffID: member.ref.StaffID.Int64()})
	}
	if err := t.store.InsertStaffLinks(ctx, actor.OrganizationID, record.ID, actor.AccountID, links); err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	record.Links = append(record.Links, links...)
	changes, err := t.linkChanges(actor, record.ID, links, resolved, before)
	if err != nil {
		return domain.TraegerStaffRecord{}, err
	}
	return record, t.store.AppendStaffChanges(ctx, actor.OrganizationID, changes)
}

// lockLinkRecord locks the record a link extends and returns it with its
// values; a new record starts empty. A record whose values differ from the
// link's read is refused (ADR 0311).
func (t *TraegerStaff) lockLinkRecord(ctx context.Context, actor workforce.TraegerStaffActor, plan linkPlan) (domain.TraegerStaffRecord, map[string]string, error) {
	if plan.record == nil {
		return domain.TraegerStaffRecord{OrganizationID: actor.OrganizationID}, nil, nil
	}
	locked, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, plan.record.ID, true)
	if err != nil {
		return domain.TraegerStaffRecord{}, nil, err
	}
	financial, err := t.openRecordFinancial(locked)
	if err != nil {
		return domain.TraegerStaffRecord{}, nil, err
	}
	before := recordValues(locked, financial)
	// collectSources puts the record first in the link's state.
	if err := readstate.Check(readstate.Fingerprint(plan.state[0]), readstate.Fingerprint(recordState(locked, before))); err != nil {
		return domain.TraegerStaffRecord{}, nil, err
	}
	return locked, before, nil
}

// linkChanges lists the trail of a link: each new Einsatzort, each value
// not taken with its school and, for an existing record, each value it
// replaced.
func (t *TraegerStaff) linkChanges(actor workforce.TraegerStaffActor, recordID int64, links []domain.TraegerStaffLink, resolved domain.ResolvedStaffFields, before map[string]string) ([]domain.TraegerStaffChange, error) {
	changes := make([]domain.TraegerStaffChange, 0, len(links)+len(resolved.NotChosen))
	for _, link := range links {
		changes = append(changes, domain.TraegerStaffChange{
			RecordID: recordID, Kind: domain.StaffChangeLinked, Field: domain.StaffChangeFieldSchool,
			SchoolID: new(link.SchoolID), AccountID: actor.AccountID,
		})
	}
	for _, notChosen := range resolved.NotChosen {
		change, err := t.trailChange(actor.OrganizationID, domain.TraegerStaffChange{
			RecordID: recordID, Kind: domain.StaffChangeNotChosen, Field: notChosen.Field,
			SchoolID: new(notChosen.Source.SchoolID), AccountID: actor.AccountID,
		}, notChosen.Value)
		if err != nil {
			return nil, err
		}
		changes = append(changes, change)
	}
	if before == nil {
		return changes, nil
	}
	replaced, err := t.replacedValues(actor, recordID, before, resolved.Values)
	return append(changes, replaced...), err
}

// replacedValues lists a changed entry with the old value of every field a
// write changed.
func (t *TraegerStaff) replacedValues(actor workforce.TraegerStaffActor, recordID int64, before, after map[string]string) ([]domain.TraegerStaffChange, error) {
	var changes []domain.TraegerStaffChange
	for _, field := range domain.StaffRecordFields {
		if strings.TrimSpace(before[field]) == strings.TrimSpace(after[field]) {
			continue
		}
		change, err := t.trailChange(actor.OrganizationID, domain.TraegerStaffChange{
			RecordID: recordID, Kind: domain.StaffChangeChanged, Field: field, AccountID: actor.AccountID,
		}, before[field])
		if err != nil {
			return nil, err
		}
		changes = append(changes, change)
	}
	return changes, nil
}

// handOver brings every live Einsatzort of the record up to date in its own
// tenant transaction: the record's personnel number on the employment, and
// no bank row of the school, because the record keeps the values (decision
// E1). Every write of the record repeats it, so a school that failed before
// catches up (ADR 0233 section 6). A link names the bank row it read per new
// employment: a school whose row changed since keeps it, the Träger's trail
// names the values it kept, and the link is refused as changed (ADR 0311)
// once every school is through. The trail names a held row right after its
// school commits the hold, so a later school that fails cannot leave a held
// row the Träger never learns of: every later catch-up keeps it silently.
func (t *TraegerStaff) handOver(ctx context.Context, actor workforce.TraegerStaffActor, record domain.TraegerStaffRecord, planned map[employmentKey]string) error {
	changed := false
	for _, link := range record.Links {
		var outcome handOverOutcome
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			var err error
			outcome, err = t.handOverSchool(ctx, actor, link, record.PersonnelNumber, plannedBankRow(planned, link))
			return err
		})
		if err != nil {
			return publicTraegerStaffError(fmt.Errorf("hand over to school %d: %w", link.SchoolID, err))
		}
		changed = changed || outcome.changed
		if outcome.held != nil {
			if err := t.recordHeldBankRows(ctx, actor, heldBankChanges(record.ID, link, actor.AccountID, *outcome.held)); err != nil {
				return err
			}
		}
	}
	if changed {
		return readstate.ErrChanged
	}
	return nil
}

// plannedBankRow is the bank row the link read for the employment, nil for
// an employment the write did not read.
func plannedBankRow(planned map[employmentKey]string, link domain.TraegerStaffLink) *string {
	expected, read := planned[employmentKey{link.SchoolID, link.StaffID}]
	if !read {
		return nil
	}
	return &expected
}

// recordHeldBankRows writes the trail entries of the row a school kept, in
// the Träger's transaction after that school committed the hold.
func (t *TraegerStaff) recordHeldBankRows(ctx context.Context, actor workforce.TraegerStaffActor, held []domain.TraegerStaffChange) error {
	if len(held) == 0 {
		return nil
	}
	err := t.released(ctx, actor, func(ctx context.Context) error {
		return t.store.AppendStaffChanges(ctx, actor.OrganizationID, held)
	})
	return publicTraegerStaffError(err)
}

// handOverOutcome is what one school's hand-over left: whether its bank row
// differs from the one the link read, and the row it held back for that.
type handOverOutcome struct {
	changed bool
	held    *domain.StaffFinancialData
}

// handOverSchool gives the employment the record's number and moves the
// school's bank row to the record (handOverBankRow).
func (t *TraegerStaff) handOverSchool(ctx context.Context, actor workforce.TraegerStaffActor, link domain.TraegerStaffLink, number *string, planned *string) (handOverOutcome, error) {
	live, err := t.schoolStaff(ctx, []int64{link.StaffID})
	if err != nil || len(live) == 0 {
		return handOverOutcome{}, err
	}
	// The school writes its bank row under the same lock and refuses one the
	// Träger keeps, so the row read below stays until this transaction ends.
	subject, err := t.subjects.LockStaff(ctx, link.StaffID, false)
	if err != nil {
		return handOverOutcome{}, err
	}
	if err := t.handOverNumber(ctx, actor, link.StaffID, subject, number); err != nil {
		return handOverOutcome{}, err
	}
	return t.handOverBankRow(ctx, actor, link, planned)
}

// handOverNumber sets the record's personnel number on the employment, with
// an audit entry when it changes.
func (t *TraegerStaff) handOverNumber(ctx context.Context, actor workforce.TraegerStaffActor, staffID int64, subject domain.StaffSubject, number *string) error {
	oldNumber, newNumber := domain.Deref(subject.PersonnelNumber), domain.Deref(number)
	if oldNumber == newNumber {
		return nil
	}
	if err := t.audit.RecordMasterDataChange(ctx, domain.MasterDataChange{
		StaffID: staffID, ChangedBy: actor.AccountID, Section: domain.AuditSectionArbeitsvertrag,
		Field: domain.StaffFieldPersonnelNumber, OldValue: oldNumber, NewValue: newNumber, Note: noteNumberOfTraeger,
	}); err != nil {
		return fmt.Errorf("write personnel number audit: %w", err)
	}
	return t.subjects.SetPersonnelNumber(ctx, staffID, number)
}

// handOverBankRow deletes the school's bank row once the record holds its
// values. With a plan it holds back a row that differs from the planned one;
// without a plan it holds back a row written after the link, which is one a
// link held back: the school cannot write a row the Träger keeps
// (refuseKeptByTraeger).
func (t *TraegerStaff) handOverBankRow(ctx context.Context, actor workforce.TraegerStaffActor, link domain.TraegerStaffLink, planned *string) (handOverOutcome, error) {
	rows, err := t.store.SchoolFinancialRows(ctx, []int64{link.StaffID})
	if err != nil {
		return handOverOutcome{}, err
	}
	if planned != nil && bankRowState(rows) != *planned {
		// A value the Personalverwaltung has not seen, like a new IBAN, is
		// neither taken over nor deleted.
		if len(rows) == 0 {
			return handOverOutcome{changed: true}, nil
		}
		// The hold stamps the row after the link, so the next write's
		// catch-up keeps it as well.
		if err := t.store.HoldSchoolFinancialRow(ctx, link.StaffID); err != nil {
			return handOverOutcome{}, err
		}
		if err := t.logHeldMasks(ctx, actor, link.StaffID, rows[0]); err != nil {
			return handOverOutcome{}, err
		}
		return handOverOutcome{changed: true, held: &rows[0]}, nil
	}
	if planned == nil && len(rows) > 0 && rows[0].UpdatedAt.After(link.LinkedAt) {
		return handOverOutcome{}, nil
	}
	return handOverOutcome{}, t.removeSchoolBankRow(ctx, actor, link.StaffID, rows)
}

// logHeldMasks writes the school's access entry for the masks of a held row
// that go into the Träger's trail (heldBankChanges), as a masked view by the
// Träger account: the school sees who read its values, like on a hand-over.
func (t *TraegerStaff) logHeldMasks(ctx context.Context, actor workforce.TraegerStaffActor, staffID int64, row domain.StaffFinancialData) error {
	if len(maskedBankValues(staffID, row)) == 0 {
		return nil
	}
	if err := t.audit.RecordDataAccess(ctx, domain.DataAccess{
		ActorAccountID: actor.AccountID, ActorRole: actorRoleTraeger,
		Resource: workforce.StaffDataAccessFinancialView, StaffID: staffID, At: t.clock.Now(),
	}); err != nil {
		return fmt.Errorf("write held bank row access audit: %w", err)
	}
	return nil
}

// maskedBankValue is one stored mask of a school's bank row.
type maskedBankValue struct{ field, mask string }

// maskedBankValues lists the masks of the values a bank row holds; nothing
// is opened.
func maskedBankValues(staffID int64, row domain.StaffFinancialData) []maskedBankValue {
	masked := domain.MaskFinancial(staffID, &row)
	var values []maskedBankValue
	for _, value := range []maskedBankValue{
		{domain.StaffFieldIBAN, domain.Deref(masked.IBANMasked)},
		{domain.StaffFieldTaxID, domain.Deref(masked.TaxIDMasked)},
		{domain.StaffFieldSocialSecurityNumber, domain.Deref(masked.SocialSecurityNumberMasked)},
	} {
		if value.mask != "" {
			values = append(values, value)
		}
	}
	return values
}

// heldBankChanges are the trail entries of a bank row a school kept: like a
// value the link did not choose, with its school and its mask.
func heldBankChanges(recordID int64, link domain.TraegerStaffLink, accountID int64, row domain.StaffFinancialData) []domain.TraegerStaffChange {
	var changes []domain.TraegerStaffChange
	for _, value := range maskedBankValues(link.StaffID, row) {
		changes = append(changes, domain.TraegerStaffChange{
			RecordID: recordID, Kind: domain.StaffChangeNotChosen, Field: value.field,
			ValueMasked: new(value.mask), SchoolID: new(link.SchoolID), AccountID: accountID,
		})
	}
	return changes
}

// removeSchoolBankRow deletes the school's bank row of an employment the
// record holds, with an audit entry per value the school had. Only the masks
// go into the school's trail; nothing is opened.
func (t *TraegerStaff) removeSchoolBankRow(ctx context.Context, actor workforce.TraegerStaffActor, staffID int64, rows []domain.StaffFinancialData) error {
	if len(rows) == 0 {
		return nil
	}
	for _, value := range maskedBankValues(staffID, rows[0]) {
		if err := t.audit.RecordMasterDataChange(ctx, domain.MasterDataChange{
			StaffID: staffID, ChangedBy: actor.AccountID, Section: domain.AuditSectionBankSteuer, Field: value.field,
			OldValue: value.mask, NewValue: "", Note: noteHandedToTraeger,
		}); err != nil {
			return fmt.Errorf("write bank hand-over audit: %w", err)
		}
	}
	return t.store.DeleteSchoolFinancialRow(ctx, staffID)
}

// UpdatePersonnelNumber sets the Träger's number on the record and on every
// live Einsatzort. A number another record of the Träger or another
// employment of one of its schools holds is refused before anything changes.
func (t *TraegerStaff) UpdatePersonnelNumber(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, value *string) (workforce.TraegerStaffRecordDetail, error) {
	number, err := domain.NormalizePersonnelNumber(value)
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	var record domain.TraegerStaffRecord
	err = t.released(ctx, actor, func(ctx context.Context) error {
		record, err = t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false)
		return err
	})
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	if number != nil {
		if err := t.numberFreeAtSchools(ctx, record.Links, *number); err != nil {
			return workforce.TraegerStaffRecordDetail{}, err
		}
	}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		locked, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
		if err != nil || domain.Deref(locked.PersonnelNumber) == domain.Deref(number) {
			return err
		}
		change, err := t.trailChange(actor.OrganizationID, domain.TraegerStaffChange{
			RecordID: recordID, Kind: domain.StaffChangeChanged, Field: domain.StaffFieldPersonnelNumber, AccountID: actor.AccountID,
		}, domain.Deref(locked.PersonnelNumber))
		if err != nil {
			return err
		}
		locked.PersonnelNumber = number
		if _, err := t.store.SaveStaffRecord(ctx, locked); err != nil {
			return err
		}
		record = locked
		return t.store.AppendStaffChanges(ctx, actor.OrganizationID, []domain.TraegerStaffChange{change})
	})
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	if err := t.handOver(ctx, actor, record, nil); err != nil {
		return workforce.TraegerStaffRecordDetail{}, err
	}
	return t.Record(ctx, actor, recordID)
}

// numberFreeAtSchools refuses a number another live employment of one of the
// record's schools holds, before anything changes (ADR 0089 section 5, ADR
// 0233 section 5): the school keeps one number per employment. It reads only
// the employments' numbers, no person.
func (t *TraegerStaff) numberFreeAtSchools(ctx context.Context, links []domain.TraegerStaffLink, number string) error {
	for _, link := range links {
		err := t.ports.Runtime.WithinSchool(ctx, link.SchoolID, func(ctx context.Context) error {
			employments, err := t.ports.Employments.SchoolEmployments(ctx, nil)
			if err != nil {
				return err
			}
			for _, employment := range employments {
				if employment.StaffID != link.StaffID && domain.Deref(employment.PersonnelNumber) == number {
					return workforce.ErrPersonnelNumberTaken
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}
