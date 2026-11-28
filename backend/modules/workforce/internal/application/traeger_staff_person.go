package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// UpdatePerson corrects first name, last name and birthday of the record
// (#7379). Every changed or removed field writes its old value into the
// trail in the same Träger transaction; unchanged values write nothing. The
// schools keep their own person rows (ADR 0089 section 3): the correction
// reaches the Träger's lists, exports, the proposals and the duplicate check
// of a hire. A person changed since the form read it is refused under the
// record lock (ADR 0311).
func (t *TraegerStaff) UpdatePerson(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, input workforce.TraegerStaffPerson) error {
	person, err := domain.NormalizeStaffPerson(domain.StaffPerson{
		FirstName: input.FirstName, LastName: input.LastName, Birthday: domain.Deref(input.Birthday),
	}, calendar.Date(t.clock.Today()))
	if refused, ok := errors.AsType[*domain.StaffPersonError](err); ok {
		return &workforce.TraegerStaffPersonError{Field: refused.Field, Cause: err}
	}
	if err != nil {
		return publicTraegerStaffError(err)
	}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		locked, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
		if err != nil {
			return err
		}
		if err := readstate.Check(input.ExpectedVersion, personVersion(locked)); err != nil {
			return err
		}
		corrected, changed := locked.ApplyPerson(person)
		if len(changed) == 0 {
			return nil
		}
		trail := make([]domain.TraegerStaffChange, 0, len(changed))
		for _, change := range changed {
			entry, err := t.trailChange(actor.OrganizationID, domain.TraegerStaffChange{
				RecordID: recordID, Kind: change.Kind, Field: change.Field, AccountID: actor.AccountID,
			}, change.Before)
			if err != nil {
				return err
			}
			trail = append(trail, entry)
		}
		if _, err := t.store.SaveStaffRecord(ctx, corrected); err != nil {
			return err
		}
		return t.store.AppendStaffChanges(ctx, actor.OrganizationID, trail)
	})
	return publicTraegerStaffError(err)
}

// noteAdoptedFromTraeger marks the school's audit entries of a take-over.
const noteAdoptedFromTraeger = "Aus der Personalakte des Trägers übernommen"

// AdoptPersonAtSchool writes the record's person into the person of one
// Einsatzort (#8208). The record is read in the Träger transaction, the
// school's person is locked and written in that school's tenant transaction
// with an audit entry per changed field (ADR 0105): no other school and no
// field the record leaves empty is touched. Nothing is pushed by itself; the
// Personalverwaltung decides per school.
func (t *TraegerStaff) AdoptPersonAtSchool(ctx context.Context, actor workforce.TraegerStaffActor, recordID, schoolID int64, expectedVersion string) error {
	var record domain.TraegerStaffRecord
	var link domain.TraegerStaffLink
	err := t.released(ctx, actor, func(ctx context.Context) error {
		found, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, false)
		if err != nil {
			return err
		}
		if err := readstate.Check(expectedVersion, personVersion(found)); err != nil {
			return err
		}
		var ok bool
		if link, ok = recordLink(found, schoolID); !ok {
			return domain.ErrTraegerStaffRecordMissing
		}
		record = found
		return nil
	})
	if err != nil {
		return publicTraegerStaffError(err)
	}
	err = t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		return t.adoptAtSchool(ctx, actor, record, link.StaffID)
	})
	return publicTraegerStaffError(err)
}

// adoptAtSchool writes the record's person into the live employment's
// person, in the caller's tenant transaction.
func (t *TraegerStaff) adoptAtSchool(ctx context.Context, actor workforce.TraegerStaffActor, record domain.TraegerStaffRecord, staffID int64) error {
	live, err := t.schoolStaff(ctx, []int64{staffID})
	if err != nil {
		return err
	}
	if len(live) == 0 {
		return domain.ErrTraegerStaffRecordMissing
	}
	subject, err := t.subjects.LockStaff(ctx, staffID, true)
	if err != nil {
		return err
	}
	school := domain.StaffPerson{FirstName: subject.FirstName, LastName: subject.LastName, Birthday: subject.Birthday}
	adopted, err := record.PersonForSchool(school)
	if refused, ok := errors.AsType[*domain.StaffPersonError](err); ok {
		return &workforce.TraegerStaffPersonError{Field: refused.Field, Cause: err}
	}
	if err != nil {
		return err
	}
	changes := []domain.FieldChange{
		{Field: domain.StaffFieldFirstName, OldValue: school.FirstName, NewValue: adopted.FirstName},
		{Field: domain.StaffFieldLastName, OldValue: school.LastName, NewValue: adopted.LastName},
		{Field: domain.StaffFieldBirthday, OldValue: school.Birthday, NewValue: adopted.Birthday},
	}
	written := false
	for _, change := range changes {
		if change.OldValue == change.NewValue {
			continue
		}
		written = true
		if err := t.audit.RecordMasterDataChange(ctx, domain.MasterDataChange{
			StaffID: staffID, ChangedBy: actor.AccountID, Section: domain.AuditSectionPerson,
			Field: change.Field, OldValue: change.OldValue, NewValue: change.NewValue, Note: noteAdoptedFromTraeger,
		}); err != nil {
			return err
		}
	}
	if !written {
		return nil
	}
	var birthday *string
	if adopted.Birthday != "" {
		birthday = &adopted.Birthday
	}
	return t.subjects.UpdatePerson(ctx, subject.PersonID, adopted.FirstName, adopted.LastName, birthday)
}
