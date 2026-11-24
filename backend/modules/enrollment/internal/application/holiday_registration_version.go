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
// child's booked weeks, time models, days, lunch and placement. The Büro's
// card shows the placement and the Büro rebooks on it, for example drops a
// week it reads as a waiting place (ADR 0314): a booking that moved up from
// the waiting list or got its place by allocation since the read refuses the
// save. Every writer of a placement holds the period lock the check holds.
// The position on the waiting list is left out: it moves with other
// registrations and no rebooking of this one decides on it.
func holidayRegistrationVersion(detail enrollment.HolidayRegistrationDetail) string {
	stored := holidayStoredFromDetail(detail)
	placements := make([][]string, len(detail.Children))
	for i, child := range detail.Children {
		placements[i] = make([]string, len(child.Bookings))
		for j, booking := range child.Bookings {
			placements[i][j] = booking.Placement
		}
	}
	return readstate.Fingerprint(struct {
		Status     string
		Input      enrollment.HolidayRegistrationInput
		ChildIDs   []int64
		Placements [][]string
	}{detail.Status, stored.input, stored.childIDs, placements})
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
