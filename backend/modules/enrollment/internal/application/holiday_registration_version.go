package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The version of a holiday registration (ADR 0311): an edit of its details
// and a rebooking of a child send the version the Büro read; Enrollment
// compares it under the period and registration locks of change.

// editedDetail reads what the Büro edits and rebooks on a registration (its
// details, contacts, answers without health information and bookings) and
// stamps the detail with its Version (ADR 0311). The detail read and the
// check of an edit or a rebooking both take the token from here.
func (h *HolidayRegistrationReview) editedDetail(ctx context.Context, organizationID int64, period enrollment.HolidayPeriod, registrationID int64) (enrollment.HolidayRegistrationDetail, error) {
	read, overrides, err := h.store.ReadHolidayReview(ctx, organizationID, period.ID.Int64(), registrationID)
	if err != nil {
		return enrollment.HolidayRegistrationDetail{}, fmt.Errorf("enrollment: read holiday registration: %w", err)
	}
	if len(read) == 0 {
		return enrollment.HolidayRegistrationDetail{}, enrollment.ErrHolidayRegistrationEntryNotFound
	}
	if err := h.completeWithLunch(ctx, period, read, overrides); err != nil {
		return enrollment.HolidayRegistrationDetail{}, err
	}
	detail := read[0]
	if detail.Contacts, err = h.store.ReadHolidayContacts(ctx, organizationID, registrationID); err != nil {
		return enrollment.HolidayRegistrationDetail{}, fmt.Errorf("enrollment: read holiday registration contacts: %w", err)
	}
	if err := h.detailAnswers(ctx, organizationID, period.ID.Int64(), &detail); err != nil {
		return enrollment.HolidayRegistrationDetail{}, err
	}
	detail.Version = holidayRegistrationVersion(detail)
	return detail, nil
}

// holidayRegistrationVersion is the token of a registration as the Büro
// edits and rebooks it: its status, the details an edit replaces and every
// child's booked weeks, time models, days and lunch. The placement of a
// booking is left out: the places decide it, not the Büro's input, and a
// booking moving up from the waiting list changes no choice the Büro made.
func holidayRegistrationVersion(detail enrollment.HolidayRegistrationDetail) string {
	stored := holidayStoredFromDetail(detail)
	return readstate.Fingerprint(struct {
		Status   string
		Input    enrollment.HolidayRegistrationInput
		ChildIDs []int64
	}{detail.Status, stored.input, stored.childIDs})
}

// checkReadRegistration refuses with readstate.ErrChanged unless expected
// is the Version of the registration as stored now. The caller holds the
// period and the registration (change).
func (h *HolidayRegistrationReview) checkReadRegistration(ctx context.Context, organizationID int64, period enrollment.HolidayPeriod, registrationID int64, expected string) error {
	current, err := h.editedDetail(ctx, organizationID, period, registrationID)
	if err != nil {
		return err
	}
	return readstate.Check(expected, current.Version)
}
