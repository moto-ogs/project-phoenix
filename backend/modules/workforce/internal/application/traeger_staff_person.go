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
