package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The debtor numbers of the children of a holiday registration (#7007).
// When the Träger keeps the number per child, each child of a registration
// is billed on an invoice of its own with its own number. The confirmation
// proposes the number each child has and keeps what the office enters as the
// child's number; the office changes them later the same way. The children
// are those of the registration as Enrollment reads it for the Träger, never
// names from the request.
//
// A change and a confirmation that sends the numbers carry the Version of
// the numbers the office read (ADR 0311). The numbers of a family have five
// writers: this change, the confirmation, the list of families and the two
// imports. Each takes the lock of the family's child numbers
// (ChildNumberStore.LockChildDebtorNumbers) before it writes, and the check
// reads the numbers under it. The lock comes after the rows of the families
// (LockFamilies) and after every lock of Enrollment, never before them.

// childDebtorNumberField is the field of a child's number in a validation
// error.
func childDebtorNumberField(childID int64) string {
	return fmt.Sprintf("child_debtor_number_%d", childID)
}

// holidayChildDebtorNumbers names every child of the registration with the
// number it has, recorded in the trail of each number it shows. The first
// child's number is the registration's proposal.
func (h *HolidayContributions) holidayChildDebtorNumbers(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	registration parentbilling.HolidayRegistration,
) (parentbilling.HolidayFamilyDebtorNumber, error) {
	result := parentbilling.HolidayFamilyDebtorNumber{Children: make([]parentbilling.HolidayChildDebtorNumber, 0, len(registration.Children))}
	if len(registration.Children) == 0 {
		return result, nil
	}
	numbers, err := h.store.ChildDebtorNumbers(ctx, reviewer.OrganizationID)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	byKey := make(map[string]parentbilling.ChildDebtorNumber, len(numbers))
	for _, number := range numbers {
		if number.DebtorNumber != "" {
			byKey[number.Key()] = number
		}
	}
	var read []parentbilling.ChildDebtorNumber
	for _, child := range registration.Children {
		shown := parentbilling.HolidayChildDebtorNumber{ChildID: ident.ID(child.ID), FirstName: child.FirstName, LastName: child.LastName}
		if number, ok := byKey[holidayChildKey(registration, child)]; ok {
			shown.DebtorNumber = number.DebtorNumber
			read = append(read, number)
		}
		result.Children = append(result.Children, shown)
	}
	result.DebtorNumber = result.Children[0].DebtorNumber
	result.Version = holidayChildNumbersVersion(registration, numbers)
	if err := h.store.InsertChildDebtorNumberEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingRead, read); err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, fmt.Errorf("parent billing: record the read of the children's numbers: %w", err)
	}
	return result, nil
}

// holidayChildNumbersVersion is the token of the children's numbers as the
// office reads them (ADR 0311): the number each child of the registration
// has, empty for none. The read, the answer of a change and the check take
// it from here over the numbers as stored.
func holidayChildNumbersVersion(registration parentbilling.HolidayRegistration, numbers []parentbilling.ChildDebtorNumber) string {
	byKey := make(map[string]string, len(numbers))
	for _, number := range numbers {
		byKey[number.Key()] = number.DebtorNumber
	}
	type shown struct {
		ChildID      int64
		DebtorNumber string
	}
	children := make([]shown, len(registration.Children))
	for i, child := range registration.Children {
		children[i] = shown{ChildID: child.ID}
		if key := holidayChildKey(registration, child); key != "" {
			children[i].DebtorNumber = byKey[key]
		}
	}
	slices.SortFunc(children, func(a, b shown) int {
		switch {
		case a.ChildID < b.ChildID:
			return -1
		case a.ChildID > b.ChildID:
			return 1
		}
		return 0
	})
	return readstate.Fingerprint(children)
}

// holdChildNumbers takes the lock of the children's numbers of the families
// of the holders and reads the numbers under it. The caller holds the rows
// of those families already.
func (h *HolidayContributions) holdChildNumbers(ctx context.Context, organizationID int64,
	holders []parentbilling.HolidayRegistration,
) ([]parentbilling.ChildDebtorNumber, error) {
	families := make([]string, len(holders))
	for i, holder := range holders {
		families[i] = holder.GuardianEmail
	}
	if err := h.store.LockChildDebtorNumbers(ctx, organizationID, families); err != nil {
		return nil, err
	}
	return h.store.ChildDebtorNumbers(ctx, organizationID)
}

// holidayChildKey is the key of a child of the registration within the
// Träger; empty when the registration has no family or the child no name.
func holidayChildKey(registration parentbilling.HolidayRegistration, child parentbilling.HolidayChild) string {
	birth := child.BirthDate
	key := parentbilling.ChildKey(child.FirstName, child.LastName, &birth)
	if key == "" || parentbilling.FamilyKey(registration.GuardianEmail) == "" {
		return ""
	}
	return parentbilling.ChildDebtorNumberKey(registration.GuardianEmail, key)
}

// confirmsChildNumbers chooses validation from the configured scope and
// registration, not from the presence of the optional request array. A
// single-child registration can still use its one registration number.
func (h *HolidayContributions) confirmsChildNumbers(ctx context.Context, organizationID int64, registration parentbilling.HolidayRegistration,
	childNumbers []parentbilling.HolidayChildDebtorNumberInput,
) (bool, error) {
	perChild, err := h.perChild(ctx, organizationID)
	if err != nil {
		return false, err
	}
	if perChild && (len(registration.Children) > 1 || childNumbers != nil) {
		return true, nil
	}
	// An extra care day the monthly contribution covers is never billed
	// (#4817): the office confirms it without a number of the family.
	if registration.IncludedInFee {
		return false, nil
	}
	return false, h.requireDebtorNumber(ctx, organizationID, registration.DebtorNumber)
}

// SetHolidayChildDebtorNumbers changes the numbers of the children of a
// confirmed registration (#7007) the office read at expectedVersion: it
// holds the family's row, then the family's numbers, checks the Version and
// writes. The answer carries the Version of the numbers now stored.
func (h *HolidayContributions) SetHolidayChildDebtorNumbers(ctx context.Context, reviewer parentbilling.HolidayReviewer, periodID, registrationID int64,
	numbers []parentbilling.HolidayChildDebtorNumberInput, expectedVersion string,
) (parentbilling.HolidayFamilyDebtorNumber, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	registration, err := h.registrations.HolidayRegistration(ctx, reviewer, periodID, registrationID)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	if registration.Status != parentbilling.HolidayRegistrationConfirmed {
		return parentbilling.HolidayFamilyDebtorNumber{}, parentbilling.ErrHolidayRegistrationStateConflict
	}
	holders := []parentbilling.HolidayRegistration{registration}
	if err := h.knowFamilies(ctx, reviewer, holders); err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	stored, err := h.holdChildNumbers(ctx, reviewer.OrganizationID, holders)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	if err := readstate.Check(expectedVersion, holidayChildNumbersVersion(registration, stored)); err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	entered, err := h.enteredChildNumbers(ctx, reviewer.OrganizationID, registration, stored, numbers)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	result, err := h.keepChildNumbers(ctx, reviewer, registration, entered)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	now, err := h.store.ChildDebtorNumbers(ctx, reviewer.OrganizationID)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	result.Version = holidayChildNumbersVersion(registration, now)
	return result, nil
}

// confirmChildNumbers keeps the numbers of the children a confirmation
// takes (confirmsChildNumbers). holders are the registration and the other
// registrations of its group that learn the number afterwards
// (rememberFamilies): their families' rows, then their numbers are held
// here at once, before anything is read, so the rest of the confirmation
// takes no lock of a family it does not hold already. Numbers the office
// sent need the Version it read (expectedVersion); without numbers nothing
// read is written back.
func (h *HolidayContributions) confirmChildNumbers(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	registration parentbilling.HolidayRegistration, holders []parentbilling.HolidayRegistration, byChild bool,
	numbers []parentbilling.HolidayChildDebtorNumberInput, expectedVersion string,
) error {
	if !byChild {
		return nil
	}
	memories := familyMemories(holders, "", h.today())
	for i := range memories {
		memories[i].DebtorNumber = nil
	}
	if _, err := h.store.LockFamilies(ctx, reviewer.OrganizationID, memories); err != nil {
		return err
	}
	if err := h.knowFamilies(ctx, reviewer, []parentbilling.HolidayRegistration{registration}); err != nil {
		return err
	}
	stored, err := h.holdChildNumbers(ctx, reviewer.OrganizationID, holders)
	if err != nil {
		return err
	}
	if numbers != nil {
		if err := readstate.Check(expectedVersion, holidayChildNumbersVersion(registration, stored)); err != nil {
			return err
		}
	}
	entered, err := h.enteredChildNumbers(ctx, reviewer.OrganizationID, registration, stored, numbers)
	if err != nil {
		return err
	}
	_, err = h.keepChildNumbers(ctx, reviewer, registration, entered)
	return err
}

// keepChildNumbers gives each child named the number enteredChildNumbers
// checked; an empty one removes it. The caller made the family known to the
// list of families (knowFamilies) and holds its numbers. The answer is the
// children named with their numbers.
func (h *HolidayContributions) keepChildNumbers(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	registration parentbilling.HolidayRegistration, entered map[int64]string,
) (parentbilling.HolidayFamilyDebtorNumber, error) {
	result := parentbilling.HolidayFamilyDebtorNumber{Children: make([]parentbilling.HolidayChildDebtorNumber, 0, len(registration.Children))}
	var save []parentbilling.ChildDebtorNumber
	var remove []string
	for _, child := range registration.Children {
		number, named := entered[child.ID]
		if !named {
			// A child the office did not name keeps its number.
			continue
		}
		result.Children = append(result.Children, parentbilling.HolidayChildDebtorNumber{ChildID: ident.ID(child.ID), FirstName: child.FirstName,
			LastName: child.LastName, DebtorNumber: number})
		if number == "" {
			birth := child.BirthDate
			remove = append(remove, parentbilling.ChildKey(child.FirstName, child.LastName, &birth))
			continue
		}
		birth := child.BirthDate
		save = append(save, parentbilling.ChildDebtorNumber{FamilyEmail: registration.GuardianEmail, ChildFirstName: truncateName(child.FirstName),
			ChildLastName: truncateName(child.LastName), ChildBirthDate: &birth, DebtorNumber: number,
			LastUsedOn: lastBookedDay(registration, h.today())})
	}
	if err := h.removeChildNumbers(ctx, reviewer, registration.GuardianEmail, remove); err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	if len(save) == 0 {
		return result, nil
	}
	saved, err := h.store.SaveChildDebtorNumbers(ctx, reviewer.OrganizationID, reviewer.AccountID, save, h.today(), false)
	if err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, err
	}
	if err := h.store.InsertChildDebtorNumberEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingSave, saved); err != nil {
		return parentbilling.HolidayFamilyDebtorNumber{}, fmt.Errorf("parent billing: record the children's numbers: %w", err)
	}
	return result, nil
}

// enteredChildNumbers checks the entered numbers: only children of the
// registration, each in the Träger's format, and, when the Träger asks for
// a number, one for every child, entered or stored. The errors name the
// field of each child.
func (h *HolidayContributions) enteredChildNumbers(ctx context.Context, organizationID int64, registration parentbilling.HolidayRegistration,
	numbers []parentbilling.ChildDebtorNumber, inputs []parentbilling.HolidayChildDebtorNumberInput,
) (map[int64]string, error) {
	if parentbilling.FamilyKey(registration.GuardianEmail) == "" {
		return nil, parentbilling.ErrChildNotFound
	}
	stored, err := storedHolidayChildNumbers(registration, numbers)
	if err != nil {
		return nil, err
	}
	required, err := h.asksDebtorNumber(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	format, err := debtorNumberFormatOf(ctx, h.settings, organizationID)
	if err != nil {
		return nil, err
	}
	entered := make(map[int64]string, len(inputs))
	errs := validation.Errors{}
	for _, input := range inputs {
		previous, known := stored[input.ChildID.Int64()]
		if !known {
			return nil, parentbilling.ErrChildNotFound
		}
		number := strings.TrimSpace(input.DebtorNumber)
		if number != previous {
			checked, err := debtorNumberOf(input.DebtorNumber, format)
			if err != nil {
				errs[childDebtorNumberField(input.ChildID.Int64())] = fieldError(err)
				continue
			}
			number = checked
		}
		entered[input.ChildID.Int64()] = number
	}
	// A registration of an included extra day is never billed (#4817): the
	// numbers entered are checked, none is required.
	if required && !registration.IncludedInFee {
		requireChildNumbers(stored, entered, errs)
	}
	if len(errs) > 0 {
		return nil, errs
	}
	return entered, nil
}

// storedHolidayChildNumbers limits the stored values read under the lock
// to children of this registration, including children without a number.
func storedHolidayChildNumbers(registration parentbilling.HolidayRegistration, numbers []parentbilling.ChildDebtorNumber) (map[int64]string, error) {
	byKey := make(map[string]string, len(numbers))
	for _, number := range numbers {
		byKey[number.Key()] = number.DebtorNumber
	}
	stored := make(map[int64]string, len(registration.Children))
	for _, child := range registration.Children {
		key := holidayChildKey(registration, child)
		if key == "" {
			return nil, parentbilling.ErrChildNotFound
		}
		stored[child.ID] = byKey[key]
	}
	return stored, nil
}

// requireChildNumbers refuses a missing number, whether omitted or cleared.
func requireChildNumbers(stored, entered map[int64]string, errs validation.Errors) {
	for id, previous := range stored {
		field := childDebtorNumberField(id)
		if _, refused := errs[field]; refused {
			continue
		}
		number, named := entered[id]
		if (named && number == "") || (!named && previous == "") {
			errs[field] = errors.New("is required")
		}
	}
}

// fieldError is the refusal of a number without the field debtorNumberOf
// names, so it can stand at the field of a child.
func fieldError(err error) error {
	var fields validation.Errors
	if errors.As(err, &fields) {
		for _, refusal := range fields {
			return refusal
		}
	}
	return err
}

// removeChildNumbers empties the requested numbers and records the old
// values in one batch, preserving the known children.
func (h *HolidayContributions) removeChildNumbers(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	familyEmail string, childKeys []string,
) error {
	removed, err := h.store.DeleteChildDebtorNumbers(ctx, reviewer.OrganizationID, reviewer.AccountID,
		parentbilling.FamilyKey(familyEmail), childKeys)
	if err != nil {
		return err
	}
	if err := h.store.InsertChildDebtorNumberEvents(ctx, reviewer.OrganizationID, reviewer.AccountID, familyBillingDelete, removed); err != nil {
		return fmt.Errorf("parent billing: record the removal of the children's numbers: %w", err)
	}
	return nil
}
