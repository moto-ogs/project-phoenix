package application

import (
	"context"
	"errors"
	"fmt"
	"slices"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The due dates of a calculated run (#4689): per payment method the day its
// invoices are due, changed on the dates the Abrechnung read (ADR 0311).

// SetCareRunDueDates replaces the due dates of a calculated monthly run as
// the Abrechnung read them: under the lock of the run, dates changed since
// expectedVersion are refused with readstate.ErrChanged (ADR 0311).
func (t *BillingTerms) SetCareRunDueDates(ctx context.Context, reviewer parentbilling.HolidayReviewer, runID int64, dates parentbilling.RunDueDates,
	expectedVersion string,
) (parentbilling.RunDueDates, error) {
	if err := validReviewer(reviewer); err != nil {
		return nil, err
	}
	if err := validDueDates(dates); err != nil {
		return nil, err
	}
	if runID <= 0 {
		return nil, parentbilling.ErrCareRunNotFound
	}
	run, err := t.store.CareRun(ctx, reviewer.OrganizationID, runID, true)
	if err != nil {
		return nil, err
	}
	if run.Status != parentbilling.RunCalculated {
		return nil, closedRunError(run.Status)
	}
	if err := t.dueDatesAsRead(ctx, reviewer.OrganizationID, run.ID.Int64(), 0, expectedVersion); err != nil {
		return nil, err
	}
	if err := t.store.ReplaceRunDueDates(ctx, reviewer.OrganizationID, reviewer.AccountID, run.ID.Int64(), 0, dates); err != nil {
		return nil, err
	}
	return dates, nil
}

// SetHolidayRunDueDates replaces the due dates of a calculated holiday run
// as the Abrechnung read them, like SetCareRunDueDates.
func (t *BillingTerms) SetHolidayRunDueDates(ctx context.Context, reviewer parentbilling.HolidayReviewer, runID int64, dates parentbilling.RunDueDates,
	expectedVersion string,
) (parentbilling.RunDueDates, error) {
	if err := validReviewer(reviewer); err != nil {
		return nil, err
	}
	if err := validDueDates(dates); err != nil {
		return nil, err
	}
	if runID <= 0 {
		return nil, parentbilling.ErrBillingRunNotFound
	}
	run, err := t.store.LockBillingRun(ctx, reviewer.OrganizationID, runID)
	if err != nil {
		return nil, err
	}
	if run.Status != parentbilling.RunCalculated {
		return nil, closedRunError(run.Status)
	}
	if err := t.dueDatesAsRead(ctx, reviewer.OrganizationID, 0, run.ID.Int64(), expectedVersion); err != nil {
		return nil, err
	}
	if err := t.store.ReplaceRunDueDates(ctx, reviewer.OrganizationID, reviewer.AccountID, 0, run.ID.Int64(), dates); err != nil {
		return nil, err
	}
	return dates, nil
}

// dueDatesAsRead refuses a change of the due dates of a run that changed
// since the Abrechnung read them at expectedVersion. The caller holds the
// lock of the run, under which every change of its dates runs.
func (t *BillingTerms) dueDatesAsRead(ctx context.Context, organizationID, careRunID, holidayRunID int64, expectedVersion string) error {
	_, _, stored, err := t.store.InvoicePaymentTerms(ctx, organizationID, careRunID, holidayRunID)
	if err != nil {
		return fmt.Errorf("parent billing: read the due dates of the run: %w", err)
	}
	return readstate.Check(expectedVersion, runDueDatesVersion(stored))
}

// runDueDatesVersion is the read-state token of the due dates of a run
// (ADR 0311): the dates in payment order, none for a run without dates.
func runDueDatesVersion(dates parentbilling.RunDueDates) string {
	return readstate.Fingerprint(dates.InPaymentOrder())
}

func validDueDates(dates parentbilling.RunDueDates) error {
	errs := validation.Errors{}
	for method, due := range dates {
		if !slices.Contains(parentbilling.PaymentMethods, method) {
			errs[method] = errors.New("is no payment method")
		} else if due.IsZero() {
			errs[method] = errors.New("must be a date")
		}
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}
