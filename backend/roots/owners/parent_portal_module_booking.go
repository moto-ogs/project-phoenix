package owners

import (
	"context"
	"errors"

	settingsValues "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// ParentChildReadsForBookedSchools hides the children of a school that has
// not booked Eltern-App from the parents portal (#4895). A guardian with
// children at two schools keeps the portal while one of them books the
// module; the other school's children, their messages, Elternbriefe and
// requests stay out of it. Every per-child flow resolves the child here, so
// such a child reads as not linked. A failed read is an error, never a
// booking decision. The portal reads its children inside an administrative
// transaction, so the switches come from the batch read that joins it: a
// read per school would open a school transaction inside it (#7967).
func ParentChildReadsForBookedSchools(reads parentportal.ChildReads, settings CalendarBookingSettings) (parentportal.ChildReads, error) {
	if reads == nil {
		return nil, nil
	}
	if settings == nil {
		return nil, errors.New("parent portal children: settings reader is required")
	}
	module, ok := settingsValues.LookupModule(settingsValues.ModuleElternApp)
	if !ok {
		return nil, errors.New("parent portal children: module Eltern-App is not registered")
	}
	return bookedParentChildReads{reads: reads, bookings: calendarElternAppBookings{settings: settings, key: module.SettingKey}}, nil
}

type bookedParentChildReads struct {
	reads    parentportal.ChildReads
	bookings calendarElternAppBookings
}

func (r bookedParentChildReads) FindForAccount(ctx context.Context, accountID, studentID int64) (*parentportal.ChildSummary, error) {
	child, err := r.reads.FindForAccount(ctx, accountID, studentID)
	if err != nil {
		return nil, err
	}
	if child == nil {
		return nil, nil
	}
	booked, err := r.bookings.ElternAppBooked(ctx, []int64{child.TenantID})
	if err != nil {
		return nil, err
	}
	if !booked[child.TenantID] {
		// Not linked as far as the portal is concerned.
		return nil, nil
	}
	return child, nil
}

func (r bookedParentChildReads) ListByAccount(ctx context.Context, accountID int64) ([]*parentportal.ChildSummary, error) {
	children, err := r.reads.ListByAccount(ctx, accountID)
	if err != nil {
		return children, err
	}
	schoolIDs := make([]int64, len(children))
	for i, child := range children {
		schoolIDs[i] = child.TenantID
	}
	booked, err := r.bookings.ElternAppBooked(ctx, schoolIDs)
	if err != nil {
		return nil, err
	}
	kept := make([]*parentportal.ChildSummary, 0, len(children))
	for _, child := range children {
		if booked[child.TenantID] {
			kept = append(kept, child)
		}
	}
	return kept, nil
}
