package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The payer of a confirmed holiday registration (#8158, ADR 0325). The
// change computes the registration again within its sibling group, like the
// confirmation of a further registration of the group: from the base prices
// the confirmation froze, with the chain settings the group froze (ADR 0115
// addendum #5664) and the rules valid on the first booked day, and
// overrides who pays. The sibling rule ranks by base price or age, never by
// the payer, so the change itself moves no other registration of the group.

var _ parentbilling.HolidayPayerChanges = (*HolidayContributions)(nil)

// PreviewHolidayPayer previews the change. Enrollment checks the Träger and
// records the read of the registration.
func (h *HolidayContributions) PreviewHolidayPayer(ctx context.Context, reviewer parentbilling.HolidayReviewer, periodID, registrationID int64, choice parentbilling.HolidayPayerChoice) (parentbilling.HolidayPayerPreview, error) {
	if reviewer.OrganizationID <= 0 || reviewer.AccountID <= 0 {
		return parentbilling.HolidayPayerPreview{}, errTraegerRequired
	}
	bearer, err := h.chosenCostBearer(ctx, reviewer.OrganizationID, choice.BenefitsExemption, choice.CostBearerID, false)
	if err != nil {
		return parentbilling.HolidayPayerPreview{}, err
	}
	registration, err := h.registrations.HolidayRegistration(ctx, reviewer, periodID, registrationID)
	if err != nil {
		return parentbilling.HolidayPayerPreview{}, err
	}
	members, _, err := h.siblingsOf(ctx, reviewer, periodID, registration)
	if err != nil {
		return parentbilling.HolidayPayerPreview{}, err
	}
	issued, err := h.store.IssuedRegistrations(ctx, reviewer.OrganizationID, parentbilling.ServiceHoliday, periodID)
	if err != nil {
		return parentbilling.HolidayPayerPreview{}, fmt.Errorf("parent billing: read issued invoices: %w", err)
	}
	preview, _, err := h.payerChange(ctx, reviewer.OrganizationID, members, registration, holidayMemberChoice{exemption: choice.BenefitsExemption, bearer: bearer})
	preview.Invoiced = issued[registration.ID]
	return preview, err
}

// ChangeHolidayPayer holds the chosen cost bearer, the invoices of the
// period and the period in Enrollment like a confirmation, so no release,
// rebooking or deletion of the cost bearer runs in between. It computes the
// change under those locks and compares it with the preview the office read
// before it writes. An issued invoice keeps its positions: the registration
// gets its new version all the same, and its page shows that the invoice
// billed another amount, like after a cancelled sibling (#5662). The caller
// rolls the transaction back when this fails.
func (h *HolidayContributions) ChangeHolidayPayer(ctx context.Context, reviewer parentbilling.HolidayReviewer, periodID, registrationID int64,
	choice parentbilling.HolidayPayerChoice, reason, expectedFingerprint string,
) (parentbilling.HolidayContribution, error) {
	if reviewer.OrganizationID <= 0 || reviewer.AccountID <= 0 {
		return parentbilling.HolidayContribution{}, errTraegerRequired
	}
	bearer, err := h.chosenCostBearer(ctx, reviewer.OrganizationID, choice.BenefitsExemption, choice.CostBearerID, true)
	if err != nil {
		return parentbilling.HolidayContribution{}, err
	}
	registration, members, issued, err := h.lockedPayerGroup(ctx, reviewer, periodID, registrationID)
	if err != nil {
		return parentbilling.HolidayContribution{}, err
	}
	preview, next, err := h.payerChange(ctx, reviewer.OrganizationID, members, registration, holidayMemberChoice{exemption: choice.BenefitsExemption, bearer: bearer})
	if err != nil {
		return parentbilling.HolidayContribution{}, err
	}
	if err := readstate.Check(expectedFingerprint, preview.Fingerprint); err != nil {
		return parentbilling.HolidayContribution{}, err
	}
	if preview.Changed {
		record := parentbilling.HolidayPayerRecord{Before: preview.Current, After: preview.Chosen, Reason: reason}
		if err := h.freezePayer(ctx, reviewer, periodID, registration.ID, record, next, members, issued); err != nil {
			return parentbilling.HolidayContribution{}, err
		}
	}
	frozen, found, err := h.store.HolidayContributions(ctx, reviewer.OrganizationID, registration.ID)
	if err != nil {
		return parentbilling.HolidayContribution{}, fmt.Errorf("parent billing: read holiday contribution: %w", err)
	}
	if !found {
		return parentbilling.HolidayContribution{}, parentbilling.ErrHolidayRegistrationStateConflict
	}
	return h.withInvoice(ctx, reviewer.OrganizationID, periodID, registration.ID, frozen)
}

// lockedPayerGroup holds the invoices of the period and the period in
// Enrollment, then reads the registration, its sibling group and the
// registrations an issued invoice bills.
func (h *HolidayContributions) lockedPayerGroup(ctx context.Context, reviewer parentbilling.HolidayReviewer, periodID, registrationID int64) (parentbilling.HolidayRegistration, []siblingMember, map[int64]bool, error) {
	groups, issued, err := h.lockSiblings(ctx, reviewer, periodID)
	if err != nil {
		return parentbilling.HolidayRegistration{}, nil, nil, err
	}
	registration, err := h.registrations.HolidayRegistration(ctx, reviewer, periodID, registrationID)
	if err != nil {
		return parentbilling.HolidayRegistration{}, nil, nil, err
	}
	ids := []int64{registration.ID}
	if group, grouped := groupOf(groups, registration.ID); grouped {
		ids = ident.Int64s(group.RegistrationIDs)
	}
	members, err := h.readSiblings(ctx, reviewer, periodID, ids, &registration)
	return registration, members, issued, err
}

// freezePayer records the change in the audit trail of the registration,
// which refuses one that is not confirmed, and freezes the new version, also
// of a registration an issued invoice bills: the invoice keeps its own
// positions. Then it freezes the rest of the group again like a
// confirmation, so the group stays one calculation; a registration an
// issued invoice bills and one whose exemption no rule allows any more keep
// their contribution.
func (h *HolidayContributions) freezePayer(ctx context.Context, reviewer parentbilling.HolidayReviewer, periodID, registrationID int64,
	record parentbilling.HolidayPayerRecord, next parentbilling.HolidayContribution, members []siblingMember, issued map[int64]bool,
) error {
	if err := h.registrations.RecordHolidayPayer(ctx, reviewer, periodID, registrationID, record); err != nil {
		return err
	}
	if err := h.store.InsertHolidayContributions(ctx, reviewer.OrganizationID, periodID, registrationID, reviewer.AccountID, next); err != nil {
		return fmt.Errorf("parent billing: freeze holiday contribution with the new payer: %w", err)
	}
	group := slices.Clone(members)
	for i := range group {
		if group[i].id() == registrationID {
			group[i].frozen = &next
		}
	}
	return h.refreeze(ctx, reviewer, periodID, group, issued, true)
}

// payerChange computes the registration with the chosen payer within its
// group and compares it with what it froze. Only a confirmed registration
// with a frozen contribution takes a change. An exemption without a valid
// rule refuses, as at the confirmation.
func (h *HolidayContributions) payerChange(ctx context.Context, organizationID int64, members []siblingMember,
	registration parentbilling.HolidayRegistration, choice holidayMemberChoice,
) (parentbilling.HolidayPayerPreview, parentbilling.HolidayContribution, error) {
	at := slices.IndexFunc(members, func(member siblingMember) bool { return member.id() == registration.ID })
	if registration.Status != parentbilling.HolidayRegistrationConfirmed || at < 0 || members[at].frozen == nil {
		return parentbilling.HolidayPayerPreview{}, parentbilling.HolidayContribution{}, parentbilling.ErrHolidayRegistrationStateConflict
	}
	frozen := *members[at].frozen
	computed, err := h.computeSiblings(ctx, organizationID, members, map[int64]holidayMemberChoice{registration.ID: choice})
	if err != nil {
		return parentbilling.HolidayPayerPreview{}, parentbilling.HolidayContribution{}, err
	}
	next := computed[registration.ID]
	if choice.exemption && !next.BenefitsExemption {
		return parentbilling.HolidayPayerPreview{}, parentbilling.HolidayContribution{}, parentbilling.ErrBenefitsExemptionUnavailable
	}
	preview := parentbilling.HolidayPayerPreview{
		Current: payerOf(frozen), Chosen: payerOf(next), Children: payerEffects(frozen, next),
		ExemptionAvailable: next.ExemptionAvailable,
		Fingerprint: readstate.Fingerprint(struct{ Frozen, Next string }{
			holidayContributionFingerprint(frozen), holidayContributionFingerprint(next),
		}),
	}
	preview.Changed = !samePayer(preview.Current, preview.Chosen)
	return preview, next, nil
}

// payerOf names who pays a contribution.
func payerOf(contribution parentbilling.HolidayContribution) parentbilling.HolidayPayer {
	switch {
	case contribution.BenefitsExemption:
		return parentbilling.HolidayPayer{Kind: parentbilling.HolidayPayerExemption}
	case contribution.CostBearerID != nil:
		return parentbilling.HolidayPayer{Kind: parentbilling.HolidayPayerCostBearer, CostBearerID: contribution.CostBearerID, CostBearerName: contribution.CostBearerName}
	}
	return parentbilling.HolidayPayer{Kind: parentbilling.HolidayPayerFamily}
}

// samePayer compares two payers; two cost bearers by their ID, so a renamed
// cost bearer is still the same payer.
func samePayer(a, b parentbilling.HolidayPayer) bool {
	if a.Kind != b.Kind {
		return false
	}
	return a.CostBearerID == nil || b.CostBearerID == nil || *a.CostBearerID == *b.CostBearerID
}

// payerEffects pairs the children of the frozen contribution with the
// computed one: what the family and the cost bearer pay before and after.
func payerEffects(frozen, next parentbilling.HolidayContribution) []parentbilling.HolidayPayerChildEffect {
	effects := make([]parentbilling.HolidayPayerChildEffect, 0, len(next.Children))
	for _, child := range next.Children {
		effect := parentbilling.HolidayPayerChildEffect{
			ChildID: child.ChildID, Position: child.Position,
			FamilyAfterCents: child.TotalCents, CostBearerAfterCents: takenOverCents(child),
		}
		if k := slices.IndexFunc(frozen.Children, func(c parentbilling.HolidayChildContribution) bool { return c.ChildID == child.ChildID }); k >= 0 {
			effect.FamilyBeforeCents = frozen.Children[k].TotalCents
			effect.CostBearerBeforeCents = takenOverCents(frozen.Children[k])
		}
		effects = append(effects, effect)
	}
	return effects
}

// takenOverCents is what the cost bearer pays for a child: the takeover
// lines are negative on the family's side.
func takenOverCents(child parentbilling.HolidayChildContribution) int64 {
	var cents int64
	for _, line := range child.Lines {
		if line.Kind == parentbilling.LineCostTakeover {
			cents -= line.AmountCents
		}
	}
	return cents
}

// withInvoice marks a frozen contribution with whether an issued invoice
// bills the registration and whether that invoice billed another amount
// (#5662).
func (h *HolidayContributions) withInvoice(ctx context.Context, organizationID, periodID, registrationID int64, frozen parentbilling.HolidayContribution) (parentbilling.HolidayContribution, error) {
	billed, err := h.store.IssuedContributions(ctx, organizationID, parentbilling.ServiceHoliday, periodID)
	if err != nil {
		return parentbilling.HolidayContribution{}, fmt.Errorf("parent billing: read issued invoices: %w", err)
	}
	issued, invoiced := billed[registrationID]
	frozen.Invoiced = invoiced
	frozen.CorrectionNeeded = invoiced && !sameBilled(issued, billedBy(frozen, issued.Children))
	return frozen, nil
}
