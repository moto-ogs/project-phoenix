package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// UpdatePerson corrects first name, last name and birthday of the record
// (#7379). Every changed field writes its old value into the trail in the
// same Träger transaction; unchanged values write nothing. The schools keep
// their own person rows (ADR 0089 section 3): the correction reaches the
// Träger's lists, exports and the duplicate check of a hire.
func (t *TraegerStaff) UpdatePerson(ctx context.Context, actor workforce.TraegerStaffActor, recordID int64, input workforce.TraegerStaffPerson) (workforce.TraegerStaffRecordDetail, error) {
	person, err := domain.NormalizeStaffPerson(domain.StaffPerson{
		FirstName: input.FirstName, LastName: input.LastName, Birthday: domain.Deref(input.Birthday),
	}, calendar.Date(t.clock.Today()))
	if refused, ok := errors.AsType[*domain.StaffPersonError](err); ok {
		return workforce.TraegerStaffRecordDetail{}, &workforce.TraegerStaffPersonError{Field: refused.Field, Cause: err}
	}
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		locked, err := t.store.FindStaffRecord(ctx, actor.OrganizationID, recordID, true)
		if err != nil {
			return err
		}
		changed := locked.PersonChanges(person)
		if len(changed) == 0 {
			return nil
		}
		trail := make([]domain.TraegerStaffChange, 0, len(changed))
		for _, change := range changed {
			entry, err := t.trailChange(actor.OrganizationID, domain.TraegerStaffChange{
				RecordID: recordID, Kind: domain.StaffChangeChanged, Field: change.Field, AccountID: actor.AccountID,
			}, change.Before)
			if err != nil {
				return err
			}
			trail = append(trail, entry)
		}
		locked.FirstName, locked.LastName, locked.Birthday = person.FirstName, person.LastName, person.Birthday
		if _, err := t.store.SaveStaffRecord(ctx, locked); err != nil {
			return err
		}
		return t.store.AppendStaffChanges(ctx, actor.OrganizationID, trail)
	})
	if err != nil {
		return workforce.TraegerStaffRecordDetail{}, publicTraegerStaffError(err)
	}
	return t.Record(ctx, actor, recordID)
}
